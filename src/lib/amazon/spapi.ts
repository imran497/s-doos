import { marketplaces, type MarketplaceCode } from "../marketplaces";
import { getCredential } from "../credentials";
import { recordSecurityEvent } from "../security";
import { ApiError, downloadStream, downloadText, fetchWithRetry, isoDay, isoDayEnd, lwaAccessToken } from "./http";

// Amazon Selling Partner API client. Field names follow Amazon's models at
// https://github.com/amzn/selling-partner-api-models. Every call needs a seller's consent
// (a refresh token) and the matching roles on the developer app; see README.

const ENDPOINTS = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
} as const;

/** Connected = app keys saved and a seller has authorized it (refresh token). */
export const isSpApiConfigured = () =>
  Boolean(getCredential("SPAPI_CLIENT_ID") && getCredential("SPAPI_CLIENT_SECRET") && getCredential("SPAPI_REFRESH_TOKEN"));

const accessToken = () =>
  lwaAccessToken(getCredential("SPAPI_CLIENT_ID") ?? "", getCredential("SPAPI_CLIENT_SECRET") ?? "", getCredential("SPAPI_REFRESH_TOKEN") ?? "", "SP-API");

/** SPAPI_ENDPOINT overrides the regional host (used by the local mock in scripts/). */
const baseUrl = (marketplace: MarketplaceCode) => process.env.SPAPI_ENDPOINT ?? ENDPOINTS[marketplaces[marketplace].region];

async function call<T>(marketplace: MarketplaceCode, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(`${baseUrl(marketplace)}${path}`, {
    ...init,
    headers: { "x-amz-access-token": await accessToken(), "Content-Type": "application/json", ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { errors?: { message?: string }[] }).errors?.[0]?.message ?? res.statusText;
    if (res.status === 401 || res.status === 403) recordSecurityEvent("access_denied", `SP-API ${res.status} on ${path.split("?")[0]}: ${message}`);
    throw new ApiError(`SP-API ${res.status} on ${path.split("?")[0]}: ${message}`, res.status, body);
  }
  return body as T;
}

const marketplaceId = (m: MarketplaceCode) => marketplaces[m].id;
const money = (m?: { Amount?: number; CurrencyAmount?: number; CurrencyCode?: string } | null) =>
  m ? { amount: m.Amount ?? m.CurrencyAmount ?? 0, currency: m.CurrencyCode ?? "" } : null;

// ---- Sellers: which marketplaces this account sells in ----

export type Participation = { code: MarketplaceCode; storeName: string | null };

/**
 * Marketplaces the connected seller account participates in. The Sellers API is regional, so this asks
 * each region (North America, then Europe, then Far East) and returns the first that answers.
 * Amazon allows about one call a minute: callers should cache the result.
 */
export async function getMarketplaceParticipations(): Promise<Participation[]> {
  const byId = new Map(Object.entries(marketplaces).map(([code, m]) => [m.id as string, code as MarketplaceCode]));
  let lastError: unknown;
  for (const regionProbe of ["US", "UK", "JP"] as const) {
    try {
      const body = await call<{
        payload?: { marketplace?: { id?: string }; participation?: { isParticipating?: boolean }; storeName?: string }[];
      }>(regionProbe, "/sellers/v1/marketplaceParticipations");
      const found = (body.payload ?? [])
        .filter((p) => p.participation?.isParticipating && p.marketplace?.id && byId.has(p.marketplace.id))
        .map((p) => ({ code: byId.get(p.marketplace!.id!)!, storeName: p.storeName ?? null }));
      if (found.length) return found;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

// ---- Catalog Items: title, main image and Best Sellers Rank (any ASIN) ----

type CatalogItem = {
  summaries?: { marketplaceId: string; itemName?: string; brand?: string }[];
  images?: { marketplaceId: string; images?: { variant?: string; link: string; height?: number }[] }[];
  salesRanks?: {
    marketplaceId: string;
    classificationRanks?: { title: string; rank: number }[];
    displayGroupRanks?: { title: string; rank: number }[];
  }[];
};

export async function getCatalogItem(asin: string, marketplace: MarketplaceCode) {
  const id = marketplaceId(marketplace);
  const params = new URLSearchParams({ marketplaceIds: id, includedData: "summaries,images,salesRanks" });
  const item = await call<CatalogItem>(marketplace, `/catalog/2022-04-01/items/${asin}?${params}`);

  const images = item.images?.find((i) => i.marketplaceId === id)?.images ?? [];
  const main = images.filter((i) => i.variant === "MAIN").sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
  const ranks = item.salesRanks?.find((r) => r.marketplaceId === id);
  const summary = item.summaries?.find((s) => s.marketplaceId === id);

  return {
    title: summary?.itemName,
    brand: summary?.brand,
    imageUrl: main?.link,
    // Top-level category (e.g. "Toys & Games") first, then sub-categories.
    bsr: [...(ranks?.displayGroupRanks ?? []), ...(ranks?.classificationRanks ?? [])].map((r) => ({ category: r.title, rank: r.rank })),
  };
}

// ---- Reports (asynchronous: create, poll, download) ----

export async function createReport(opts: {
  reportType: string;
  marketplace: MarketplaceCode;
  start?: string;
  end?: string;
  options?: Record<string, string>;
}) {
  const body = await call<{ reportId: string }>(opts.marketplace, "/reports/2021-06-30/reports", {
    method: "POST",
    body: JSON.stringify({
      reportType: opts.reportType,
      marketplaceIds: [marketplaceId(opts.marketplace)],
      ...(opts.start ? { dataStartTime: isoDay(opts.start) } : {}),
      // An end time in the future is rejected; leaving it out means "up to now".
      ...(opts.end && Date.parse(isoDayEnd(opts.end)) < Date.now() ? { dataEndTime: isoDayEnd(opts.end) } : {}),
      ...(opts.options ? { reportOptions: opts.options } : {}),
    }),
  });
  return body.reportId;
}

/** IN_QUEUE / IN_PROGRESS / DONE / CANCELLED (no data) / FATAL. */
export async function getReportStatus(reportId: string, marketplace: MarketplaceCode) {
  const r = await call<{ processingStatus: string; reportDocumentId?: string }>(marketplace, `/reports/2021-06-30/reports/${reportId}`);
  return { status: r.processingStatus, documentId: r.reportDocumentId };
}

async function reportDocument(documentId: string, marketplace: MarketplaceCode) {
  const doc = await call<{ url: string; compressionAlgorithm?: string }>(marketplace, `/reports/2021-06-30/documents/${documentId}`);
  return { url: doc.url, gzip: doc.compressionAlgorithm === "GZIP" };
}

export async function reportText(documentId: string, marketplace: MarketplaceCode) {
  const doc = await reportDocument(documentId, marketplace);
  return downloadText(doc.url, doc.gzip);
}

/** For huge reports (Top Search Terms): a byte stream to parse incrementally. */
export async function reportStream(documentId: string, marketplace: MarketplaceCode) {
  const doc = await reportDocument(documentId, marketplace);
  return downloadStream(doc.url, doc.gzip);
}

// ---- Report parsers ----

export type SqpRow = {
  searchQuery: string;
  queryVolume: number | null;
  impressions: number | null;
  asinImpressions: number | null;
  clicks: number | null;
  asinClicks: number | null;
  cartAdds: number | null;
  asinCartAdds: number | null;
  purchases: number | null;
  asinPurchases: number | null;
  queryScore: number | null;
  asinClickPrice: number | null;
  marketClickPrice: number | null;
  asinPurchasePrice: number | null;
  marketPurchasePrice: number | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT (JSON): one entry per search query for the ASIN. */
export function parseSqp(text: string): SqpRow[] {
  type Price = { amount?: number } | null;
  const json = JSON.parse(text) as {
    dataByAsin?: {
      searchQueryData?: { searchQuery?: string; searchQueryScore?: number; searchQueryVolume?: number };
      impressionData?: { totalQueryImpressionCount?: number; asinImpressionCount?: number };
      clickData?: { totalClickCount?: number; asinClickCount?: number; totalMedianClickPrice?: Price; asinMedianClickPrice?: Price };
      cartAddData?: { totalCartAddCount?: number; asinCartAddCount?: number };
      purchaseData?: { totalPurchaseCount?: number; asinPurchaseCount?: number; totalMedianPurchasePrice?: Price; asinMedianPurchasePrice?: Price };
    }[];
  };
  const price = (p: Price | undefined) => (p && typeof p.amount === "number" ? p.amount : null);
  return (json.dataByAsin ?? [])
    .filter((d) => d.searchQueryData?.searchQuery)
    .map((d) => ({
      searchQuery: d.searchQueryData!.searchQuery!.toLowerCase(),
      queryVolume: num(d.searchQueryData?.searchQueryVolume),
      impressions: num(d.impressionData?.totalQueryImpressionCount),
      asinImpressions: num(d.impressionData?.asinImpressionCount),
      clicks: num(d.clickData?.totalClickCount),
      asinClicks: num(d.clickData?.asinClickCount),
      cartAdds: num(d.cartAddData?.totalCartAddCount),
      asinCartAdds: num(d.cartAddData?.asinCartAddCount),
      purchases: num(d.purchaseData?.totalPurchaseCount),
      asinPurchases: num(d.purchaseData?.asinPurchaseCount),
      queryScore: num(d.searchQueryData?.searchQueryScore),
      asinClickPrice: price(d.clickData?.asinMedianClickPrice),
      marketClickPrice: price(d.clickData?.totalMedianClickPrice),
      asinPurchasePrice: price(d.purchaseData?.asinMedianPurchasePrice),
      marketPurchasePrice: price(d.purchaseData?.totalMedianPurchasePrice),
    }));
}

export type SalesTrafficRow = {
  asin: string;
  units: number;
  revenue: number;
  currency: string;
  orderItems: number;
  sessions: number;
  pageViews: number;
  buyBoxPct: number | null;
  unitSessionPct: number | null;
};

/** GET_SALES_AND_TRAFFIC_REPORT (asinGranularity CHILD) for a single day: one row per child ASIN. */
export function parseSalesTraffic(text: string): SalesTrafficRow[] {
  const json = JSON.parse(text) as {
    salesAndTrafficByAsin?: {
      parentAsin?: string;
      childAsin?: string;
      salesByAsin?: { unitsOrdered?: number; totalOrderItems?: number; orderedProductSales?: { amount?: number; currencyCode?: string } };
      trafficByAsin?: { sessions?: number; pageViews?: number; buyBoxPercentage?: number; unitSessionPercentage?: number };
    }[];
  };
  return (json.salesAndTrafficByAsin ?? [])
    .filter((r) => r.childAsin ?? r.parentAsin)
    .map((r) => ({
      asin: (r.childAsin ?? r.parentAsin)!,
      units: r.salesByAsin?.unitsOrdered ?? 0,
      revenue: r.salesByAsin?.orderedProductSales?.amount ?? 0,
      currency: r.salesByAsin?.orderedProductSales?.currencyCode ?? "",
      orderItems: r.salesByAsin?.totalOrderItems ?? 0,
      sessions: r.trafficByAsin?.sessions ?? 0,
      pageViews: r.trafficByAsin?.pageViews ?? 0,
      buyBoxPct: num(r.trafficByAsin?.buyBoxPercentage),
      unitSessionPct: num(r.trafficByAsin?.unitSessionPercentage),
    }));
}

export type OrderRow = {
  orderId: string;
  /** e.g. "Amazon.com": which marketplace the order was placed in (reports can include several). */
  salesChannel: string;
  purchaseDate: string;
  status: string;
  channel: string;
  sku: string;
  asin: string;
  productName: string;
  qty: number;
  itemPrice: number;
  currency: string;
  /** Item discount from promotions (coupons, deals…), as a positive amount. */
  promoDiscount: number;
  promoIds: string;
};

/** GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL: tab-separated, one row per order item. */
export function parseOrdersFlatFile(text: string): OrderRow[] {
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];
  const headers = headerLine.split("\t");
  const col = (name: string) => headers.indexOf(name);
  const i = {
    id: col("amazon-order-id"),
    date: col("purchase-date"),
    status: col("order-status"),
    channelName: col("sales-channel"),
    channel: col("fulfillment-channel"),
    sku: col("sku"),
    asin: col("asin"),
    name: col("product-name"),
    qty: col("quantity"),
    price: col("item-price"),
    currency: col("currency"),
    promo: col("item-promotion-discount"),
    promoIds: col("promotion-ids"),
  };
  return lines.map((line) => {
    const f = line.split("\t");
    return {
      orderId: f[i.id],
      salesChannel: i.channelName >= 0 ? (f[i.channelName] ?? "") : "",
      purchaseDate: f[i.date],
      status: f[i.status],
      channel: f[i.channel] ?? "",
      sku: f[i.sku],
      asin: f[i.asin],
      productName: f[i.name] ?? "",
      qty: Number(f[i.qty]) || 0,
      itemPrice: Number(f[i.price]) || 0,
      currency: f[i.currency] ?? "",
      promoDiscount: i.promo >= 0 ? Math.abs(Number(f[i.promo]) || 0) : 0,
      promoIds: i.promoIds >= 0 ? (f[i.promoIds] ?? "").trim() : "",
    };
  });
}

export type ListingRow = {
  sku: string;
  asin: string;
  title: string;
  status: string;
  fulfillment: string;
  price: number | null;
  quantity: number | null;
  openDate: string | null;
};

/** GET_MERCHANT_LISTINGS_ALL_DATA: tab-separated, one row per SKU, active and inactive. */
export function parseListingsReport(text: string): ListingRow[] {
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];
  const headers = headerLine.split("\t").map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
  const i = {
    sku: col("seller-sku"),
    asin: col("asin1", "asin"),
    title: col("item-name"),
    status: col("status"),
    fulfillment: col("fulfillment-channel"),
    price: col("price"),
    quantity: col("quantity"),
    openDate: col("open-date"),
  };
  const at = (f: string[], idx: number) => (idx >= 0 ? (f[idx] ?? "").trim() : "");
  const number = (v: string) => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return lines
    .map((line) => {
      const f = line.split("\t");
      return {
        sku: at(f, i.sku),
        asin: at(f, i.asin),
        title: at(f, i.title),
        status: at(f, i.status),
        fulfillment: at(f, i.fulfillment),
        price: number(at(f, i.price)),
        quantity: number(at(f, i.quantity)),
        openDate: at(f, i.openDate) || null,
      };
    })
    .filter((r) => r.sku && r.asin);
}

// ---- Finances: what Amazon charged and paid, per order item ----

type Money = { CurrencyCode?: string; CurrencyAmount?: number };
type Charge = { ChargeType?: string; ChargeAmount?: Money };
type Fee = { FeeType?: string; FeeAmount?: Money };
type ShipmentItem = {
  SellerSKU?: string;
  QuantityShipped?: number;
  ItemChargeList?: Charge[];
  ItemFeeList?: Fee[];
  PromotionList?: { PromotionAmount?: Money }[];
  ItemChargeAdjustmentList?: Charge[];
  ItemFeeAdjustmentList?: Fee[];
  PromotionAdjustmentList?: { PromotionAmount?: Money }[];
};
type FinancialEvents = {
  ShipmentEventList?: { AmazonOrderId?: string; PostedDate?: string; MarketplaceName?: string; ShipmentItemList?: ShipmentItem[] }[];
  RefundEventList?: { AmazonOrderId?: string; PostedDate?: string; MarketplaceName?: string; ShipmentItemAdjustmentList?: ShipmentItem[] }[];
  ServiceFeeEventList?: { AmazonOrderId?: string; FeeReason?: string; SellerSKU?: string; ASIN?: string; FeeList?: Fee[] }[];
  AdjustmentEventList?: {
    AdjustmentType?: string;
    PostedDate?: string;
    AdjustmentAmount?: Money;
    AdjustmentItemList?: { SellerSKU?: string; ASIN?: string; TotalAmount?: Money }[];
  }[];
};

export type FeeEvent = {
  postedDate: string;
  orderId: string | null;
  sku: string | null;
  asin: string | null;
  /** e.g. "Amazon.com" for order-level events; null for account-level fees. */
  marketplaceName: string | null;
  /** sale, tax, promotion, fee, refund, service_fee or adjustment */
  kind: string;
  detail: string;
  amount: number;
  currency: string;
  /** Units shipped, set on the Principal sale row only. */
  qty: number;
};

/** Flattens Finances API events into signed amounts (money in is positive, Amazon's fees negative). */
export function flattenFinancialEvents(events: FinancialEvents, fallbackDate: string): FeeEvent[] {
  const rows: FeeEvent[] = [];
  const day = (iso?: string) => (iso ?? fallbackDate).slice(0, 10);
  const push = (r: Omit<FeeEvent, "amount" | "currency" | "qty"> & { money?: Money; qty?: number }) => {
    const amount = r.money?.CurrencyAmount ?? 0;
    if (!amount) return;
    const { money, ...rest } = r;
    rows.push({ ...rest, qty: r.qty ?? 0, amount, currency: money?.CurrencyCode ?? "" });
  };

  for (const e of events.ShipmentEventList ?? []) {
    for (const item of e.ShipmentItemList ?? []) {
      const base = { postedDate: day(e.PostedDate), orderId: e.AmazonOrderId ?? null, sku: item.SellerSKU ?? null, asin: null, marketplaceName: e.MarketplaceName ?? null };
      for (const c of item.ItemChargeList ?? [])
        push({
          ...base,
          kind: c.ChargeType === "Principal" || c.ChargeType === "ShippingCharge" || c.ChargeType === "GiftWrap" ? "sale" : "tax",
          detail: c.ChargeType ?? "",
          money: c.ChargeAmount,
          qty: c.ChargeType === "Principal" ? (item.QuantityShipped ?? 0) : 0,
        });
      for (const f of item.ItemFeeList ?? []) push({ ...base, kind: "fee", detail: f.FeeType ?? "", money: f.FeeAmount });
      for (const p of item.PromotionList ?? []) push({ ...base, kind: "promotion", detail: "Promotion", money: p.PromotionAmount });
    }
  }
  for (const e of events.RefundEventList ?? []) {
    for (const item of e.ShipmentItemAdjustmentList ?? []) {
      const base = { postedDate: day(e.PostedDate), orderId: e.AmazonOrderId ?? null, sku: item.SellerSKU ?? null, asin: null, marketplaceName: e.MarketplaceName ?? null };
      for (const c of item.ItemChargeAdjustmentList ?? [])
        push({ ...base, kind: c.ChargeType === "Principal" || c.ChargeType === "ShippingCharge" ? "refund" : "tax", detail: c.ChargeType ?? "", money: c.ChargeAmount });
      for (const f of item.ItemFeeAdjustmentList ?? []) push({ ...base, kind: "fee", detail: f.FeeType ?? "", money: f.FeeAmount });
      for (const p of item.PromotionAdjustmentList ?? []) push({ ...base, kind: "promotion", detail: "Promotion", money: p.PromotionAmount });
    }
  }
  for (const e of events.ServiceFeeEventList ?? []) {
    for (const f of e.FeeList ?? [])
      push({ postedDate: fallbackDate, orderId: e.AmazonOrderId ?? null, sku: e.SellerSKU ?? null, asin: e.ASIN ?? null, marketplaceName: null, kind: "service_fee", detail: f.FeeType ?? e.FeeReason ?? "", money: f.FeeAmount });
  }
  for (const e of events.AdjustmentEventList ?? []) {
    const items = e.AdjustmentItemList ?? [];
    if (items.length) {
      for (const it of items)
        push({ postedDate: day(e.PostedDate), orderId: null, sku: it.SellerSKU ?? null, asin: it.ASIN ?? null, marketplaceName: null, kind: "adjustment", detail: e.AdjustmentType ?? "", money: it.TotalAmount });
    } else {
      push({ postedDate: day(e.PostedDate), orderId: null, sku: null, asin: null, marketplaceName: null, kind: "adjustment", detail: e.AdjustmentType ?? "", money: e.AdjustmentAmount });
    }
  }
  return rows;
}

/** Financial events posted in [from, to] (dates). Amazon may omit orders from the last 48 hours. */
export async function listFinancialEvents(marketplace: MarketplaceCode, from: string, to: string) {
  const rows: FeeEvent[] = [];
  let next: string | undefined;
  do {
    const params = new URLSearchParams({ MaxResultsPerPage: "100", PostedAfter: isoDay(from) });
    // PostedBefore must be at least two minutes in the past.
    const before = new Date(Math.min(Date.parse(isoDayEnd(to)), Date.now() - 5 * 60_000)).toISOString();
    params.set("PostedBefore", before);
    if (next) params.set("NextToken", next);
    const body = await call<{ payload?: { NextToken?: string; FinancialEvents?: FinancialEvents } }>(
      marketplace,
      `/finances/v0/financialEvents?${params}`,
    );
    rows.push(...flattenFinancialEvents(body.payload?.FinancialEvents ?? {}, to));
    next = body.payload?.NextToken;
  } while (next);
  return rows;
}

// ---- Finances transactions (2024-06-19): every money movement, dated, including account-level fees ----

export type FinanceTransaction = { id: string; type: string; description: string; postedDate: string; amount: number; currency: string; marketplaceId: string | null };

/** Transactions posted in [from, to); Amazon allows at most 180 days per request. */
export async function listTransactions(marketplace: MarketplaceCode, from: string, to: string) {
  const rows: FinanceTransaction[] = [];
  let next: string | undefined;
  // postedBefore must be at least 2 minutes in the past.
  const before = Math.min(Date.parse(isoDay(to)), Date.now() - 3 * 60_000);
  do {
    const params = new URLSearchParams({ postedAfter: isoDay(from), postedBefore: new Date(before).toISOString(), marketplaceId: marketplaceId(marketplace) });
    if (next) params.set("nextToken", next);
    const body = await call<{
      payload?: {
        nextToken?: string;
        transactions?: {
          transactionId?: string;
          transactionType?: string;
          description?: string;
          postedDate?: string;
          totalAmount?: { currencyAmount?: number; currencyCode?: string };
          marketplaceDetails?: { marketplaceId?: string };
        }[];
      };
    }>(marketplace, `/finances/2024-06-19/transactions?${params}`);
    for (const t of body.payload?.transactions ?? []) {
      if (!t.transactionId) continue;
      rows.push({
        id: t.transactionId,
        type: t.transactionType ?? "",
        description: t.description ?? "",
        postedDate: t.postedDate ?? "",
        amount: t.totalAmount?.currencyAmount ?? 0,
        currency: t.totalAmount?.currencyCode ?? "",
        marketplaceId: t.marketplaceDetails?.marketplaceId ?? null,
      });
    }
    next = body.payload?.nextToken;
  } while (next);
  return rows;
}

// ---- FBA inventory ----

export type InventoryRow = {
  sku: string;
  asin: string;
  fulfillable: number;
  inbound: number;
  reserved: number;
  unfulfillable: number;
};

export async function getInventory(marketplace: MarketplaceCode) {
  const rows: InventoryRow[] = [];
  let next: string | undefined;
  do {
    const params = new URLSearchParams({
      details: "true",
      granularityType: "Marketplace",
      granularityId: marketplaceId(marketplace),
      marketplaceIds: marketplaceId(marketplace),
    });
    if (next) params.set("nextToken", next);
    const body = await call<{
      payload?: {
        inventorySummaries?: {
          asin?: string;
          sellerSku?: string;
          totalQuantity?: number;
          inventoryDetails?: {
            fulfillableQuantity?: number;
            inboundWorkingQuantity?: number;
            inboundShippedQuantity?: number;
            inboundReceivingQuantity?: number;
            reservedQuantity?: { totalReservedQuantity?: number } | number;
            unfulfillableQuantity?: { totalUnfulfillableQuantity?: number } | number;
          };
        }[];
      };
      pagination?: { nextToken?: string };
    }>(marketplace, `/fba/inventory/v1/summaries?${params}`);
    for (const s of body.payload?.inventorySummaries ?? []) {
      const d = s.inventoryDetails ?? {};
      const total = (v: unknown, key: string) => (typeof v === "number" ? v : ((v as Record<string, number> | undefined)?.[key] ?? 0));
      rows.push({
        sku: s.sellerSku ?? "",
        asin: s.asin ?? "",
        fulfillable: d.fulfillableQuantity ?? 0,
        inbound: (d.inboundWorkingQuantity ?? 0) + (d.inboundShippedQuantity ?? 0) + (d.inboundReceivingQuantity ?? 0),
        reserved: total(d.reservedQuantity, "totalReservedQuantity"),
        unfulfillable: total(d.unfulfillableQuantity, "totalUnfulfillableQuantity"),
      });
    }
    next = body.pagination?.nextToken;
  } while (next);
  return rows;
}

// ---- Pricing: Buy Box and offers for any ASIN (up to 20 per call) ----

export type OfferSnapshot = {
  asin: string;
  buyBoxPrice: number | null;
  lowestPrice: number | null;
  currency: string;
  offerCount: number | null;
  /** True when your own offer currently holds the Buy Box. */
  youHaveBuyBox: boolean;
};

type OffersPayload = {
  ASIN?: string;
  Summary?: {
    TotalOfferCount?: number;
    LowestPrices?: { condition?: string; LandedPrice?: { Amount?: number; CurrencyCode?: string }; ListingPrice?: { Amount?: number; CurrencyCode?: string } }[];
    BuyBoxPrices?: { condition?: string; LandedPrice?: { Amount?: number; CurrencyCode?: string } }[];
  };
  Offers?: { MyOffer?: boolean; IsBuyBoxWinner?: boolean }[];
};

export async function getOffers(marketplace: MarketplaceCode, asins: string[]) {
  const results: OfferSnapshot[] = [];
  for (let i = 0; i < asins.length; i += 20) {
    const batch = asins.slice(i, i + 20);
    const body = await call<{ responses?: { status?: { statusCode?: number }; body?: { payload?: OffersPayload } }[] }>(
      marketplace,
      "/batches/products/pricing/v0/itemOffers",
      {
        method: "POST",
        body: JSON.stringify({
          requests: batch.map((asin) => ({
            uri: `/products/pricing/v0/items/${asin}/offers`,
            method: "GET",
            MarketplaceId: marketplaceId(marketplace),
            ItemCondition: "New",
            CustomerType: "Consumer",
          })),
        }),
      },
    );
    (body.responses ?? []).forEach((r, j) => {
      const p = r.body?.payload;
      if (!p || (r.status?.statusCode ?? 200) >= 400) return;
      const newOnly = <T extends { condition?: string }>(list?: T[]) => (list ?? []).filter((x) => !x.condition || x.condition.toLowerCase() === "new");
      const buyBox = money(newOnly(p.Summary?.BuyBoxPrices)[0]?.LandedPrice);
      const lowest = newOnly(p.Summary?.LowestPrices)
        .map((l) => money(l.LandedPrice ?? l.ListingPrice))
        .filter((m): m is { amount: number; currency: string } => Boolean(m))
        .sort((a, b) => a.amount - b.amount)[0];
      results.push({
        asin: p.ASIN ?? batch[j],
        buyBoxPrice: buyBox?.amount ?? null,
        lowestPrice: lowest?.amount ?? null,
        currency: buyBox?.currency || lowest?.currency || "",
        offerCount: p.Summary?.TotalOfferCount ?? null,
        youHaveBuyBox: Boolean(p.Offers?.some((o) => o.MyOffer && o.IsBuyBoxWinner)),
      });
    });
  }
  return results;
}

// ---- Your own prices: regular price and any sale price (up to 20 SKUs per call) ----

export type MyPrice = { sku: string; regularPrice: number | null; salePrice: number | null; currency: string };

export async function getMyPrices(marketplace: MarketplaceCode, skus: string[]) {
  const results: MyPrice[] = [];
  // SKUs are passed comma-separated, so one containing a comma can't be asked for this way.
  const usable = skus.filter((s) => !s.includes(","));
  for (let i = 0; i < usable.length; i += 20) {
    const batch = usable.slice(i, i + 20);
    const params = new URLSearchParams({ MarketplaceId: marketplaceId(marketplace), ItemType: "Sku", Skus: batch.join(",") });
    const body = await call<{
      payload?: {
        status?: string;
        SellerSKU?: string;
        Product?: {
          Offers?: {
            SellerSKU?: string;
            BuyingPrice?: { ListingPrice?: { Amount?: number; CurrencyCode?: string } };
            RegularPrice?: { Amount?: number; CurrencyCode?: string };
          }[];
        };
      }[];
    }>(marketplace, `/products/pricing/v0/price?${params}`);
    for (const r of body.payload ?? []) {
      const offer = r.Product?.Offers?.find((o) => !o.SellerSKU || o.SellerSKU === r.SellerSKU) ?? r.Product?.Offers?.[0];
      if (!r.SellerSKU || !offer) continue;
      const listing = offer.BuyingPrice?.ListingPrice?.Amount ?? null;
      const regular = offer.RegularPrice?.Amount ?? listing;
      results.push({
        sku: r.SellerSKU,
        regularPrice: regular,
        // The listing price drops below the regular price while a sale price is active.
        salePrice: listing != null && regular != null && listing < regular - 0.001 ? listing : null,
        currency: offer.RegularPrice?.CurrencyCode ?? offer.BuyingPrice?.ListingPrice?.CurrencyCode ?? "",
      });
    }
  }
  return results;
}

// ---- Product fees: Amazon's estimate of referral and FBA fees at a price (up to 20 per call) ----

export type FeeEstimate = { sku: string; referralFee: number | null; fbaFee: number | null; totalFee: number | null };

export async function getFeeEstimates(marketplace: MarketplaceCode, items: { sku: string; price: number; currency: string; fba: boolean }[]) {
  const results: FeeEstimate[] = [];
  for (let i = 0; i < items.length; i += 20) {
    const batch = items.slice(i, i + 20);
    const body = await call<
      {
        Status?: string;
        FeesEstimateIdentifier?: { IdValue?: string; SellerInputIdentifier?: string };
        FeesEstimate?: {
          TotalFeesEstimate?: { Amount?: number };
          FeeDetailList?: { FeeType?: string; FinalFee?: { Amount?: number } }[];
        };
      }[]
    >(marketplace, "/products/fees/v0/feesEstimate", {
      method: "POST",
      body: JSON.stringify(
        batch.map((item) => ({
          IdType: "SellerSKU",
          IdValue: item.sku,
          FeesEstimateRequest: {
            MarketplaceId: marketplaceId(marketplace),
            IsAmazonFulfilled: item.fba,
            PriceToEstimateFees: { ListingPrice: { CurrencyCode: item.currency, Amount: item.price } },
            Identifier: item.sku,
          },
        })),
      ),
    });
    (Array.isArray(body) ? body : []).forEach((r, j) => {
      if (r.Status && r.Status !== "Success") return;
      const fee = (type: string) => r.FeesEstimate?.FeeDetailList?.find((f) => f.FeeType === type)?.FinalFee?.Amount ?? null;
      results.push({
        sku: r.FeesEstimateIdentifier?.IdValue ?? batch[j].sku,
        referralFee: fee("ReferralFee"),
        fbaFee: fee("FBAFees"),
        totalFee: r.FeesEstimate?.TotalFeesEstimate?.Amount ?? null,
      });
    });
  }
  return results;
}

// ---- Dates ----

/** The most recent full Sunday–Saturday week, which is what weekly Brand Analytics reports cover. */
export function lastFullWeek(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay() - 1); // last Saturday
  const end = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 6);
  return { start: d.toISOString().slice(0, 10), end };
}
