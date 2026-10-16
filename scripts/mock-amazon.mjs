// A local stand-in for Amazon's APIs, returning responses shaped like Amazon's documented models
// (github.com/amzn/selling-partner-api-models and the Amazon Ads Postman collection). Used by
// scripts/e2e-amazon.mts so SellerDoos can be tested without real credentials.
//
//   node scripts/mock-amazon.mjs [port]
//
// It deliberately throttles once (429), paginates, gzips some documents, and rejects the unconfirmed
// Ads column once, so the retry and fallback paths get exercised.
import http from "node:http";
import { gzipSync } from "node:zlib";

const PORT = Number(process.argv[2] ?? 4010);
const BASE = `http://localhost:${PORT}`;
const US = "ATVPDKIKX0DER";
export const OWN = "B0GZ8LVLGR";
export const RIVAL = "B07COMP0001";

const reports = new Map(); // id → { type, options, start, end, polls }
const adsReports = new Map();
const log = (...a) => process.env.MOCK_QUIET || console.log("[mock]", ...a);
let throttledOnce = false;
let rejectedTopShare = false;
let seq = 0;

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

function salesAndTraffic(date) {
  const day = Number(date.slice(8, 10));
  return {
    reportSpecification: { reportType: "GET_SALES_AND_TRAFFIC_REPORT", dataStartTime: date, dataEndTime: date, marketplaceIds: [US] },
    salesAndTrafficByDate: [{ date, salesByDate: { unitsOrdered: 10 + day }, trafficByDate: { sessions: 100 + day } }],
    salesAndTrafficByAsin: [
      {
        parentAsin: OWN,
        childAsin: OWN,
        salesByAsin: { unitsOrdered: 10 + day, orderedProductSales: { amount: (10 + day) * 24.49, currencyCode: "USD" }, totalOrderItems: 9 + day },
        trafficByAsin: { sessions: 100 + day, pageViews: 140 + day, buyBoxPercentage: 98.5, unitSessionPercentage: 10.2 },
      },
      {
        parentAsin: "B0OTHER0001",
        childAsin: "B0OTHER0001",
        salesByAsin: { unitsOrdered: 1, orderedProductSales: { amount: 9.99, currencyCode: "USD" }, totalOrderItems: 1 },
        trafficByAsin: { sessions: 12, pageViews: 15, buyBoxPercentage: 100, unitSessionPercentage: 8.3 },
      },
    ],
  };
}

function ordersFile() {
  const cols = ["amazon-order-id", "merchant-order-id", "purchase-date", "last-updated-date", "order-status", "fulfillment-channel", "sales-channel", "product-name", "sku", "asin", "item-status", "quantity", "currency", "item-price", "item-promotion-discount", "promotion-ids"];
  const rows = [
    ["111-0000001-0000001", "", "2026-10-01T10:00:00+00:00", "2026-10-02T10:00:00+00:00", "Shipped", "Amazon", "Amazon.com", "KidBees 60pc", "KB-60", OWN, "Shipped", "2", "USD", "48.98", "-5.00", "PLM-COUPON-1"],
    ["111-0000002-0000002", "", "2026-10-02T11:00:00+00:00", "2026-10-02T12:00:00+00:00", "Pending", "Amazon", "Amazon.com", "KidBees 60pc", "KB-60", OWN, "Unshipped", "1", "USD", "24.49", "0.00", ""],
    // Amazon-internal order: no price or currency, must be ignored.
    ["S01-0000003-0000003", "", "2026-10-02T12:00:00+00:00", "2026-10-02T12:00:00+00:00", "Shipped", "Amazon", "Amazon.com", "-", "KB-60", OWN, "Shipped", "5", "", "", "", ""],
  ];
  return [cols, ...rows].map((r) => r.join("\t")).join("\n");
}

export const SECOND = "B0SECOND01";

// All listings, as Amazon sends it in North America: tab-separated and Windows-1252 encoded ("™" is 0x99).
function listingsFile() {
  const cols = ["item-name", "item-description", "listing-id", "seller-sku", "price", "quantity", "open-date", "image-url", "item-is-marketplace", "product-id-type", "item-note", "item-condition", "asin1", "asin2", "asin3", "product-id", "pending-quantity", "fulfillment-channel", "merchant-shipping-group", "status"];
  const rows = [
    ["KidBees™ 60pc Magnetic Tiles", "", "L1", "KB-60", "24.49", "", "2025-03-01 10:00:00 PST", "", "y", "1", "", "11", OWN, "", "", OWN, "0", "AMAZON_NA", "", "Active"],
    ["KidBees 60pc Magnetic Tiles", "", "L2", "KB-60-M", "26.99", "4", "2025-03-01 10:00:00 PST", "", "y", "1", "", "11", OWN, "", "", OWN, "0", "DEFAULT", "Migrated Template", "Inactive"],
    ["KidBees 100pc Magnetic Tiles", "", "L3", "KB-100", "39.99", "", "2025-06-01 10:00:00 PDT", "", "y", "1", "", "11", SECOND, "", "", SECOND, "0", "AMAZON_NA", "", "Inactive"],
  ];
  const text = [cols, ...rows].map((r) => r.join("\t")).join("\n");
  return Buffer.from(text.replace("™", "\u0099"), "latin1");
}

let searchTermsGz;
function searchTermsDocument() {
  // 70,000 terms × 3 clicked ASINs = 210,000 rows. Only a handful are relevant to SellerDoos.
  if (searchTermsGz) return searchTermsGz;
  const rows = [];
  const push = (term, rank, asins) =>
    asins.forEach((asin, i) =>
      rows.push({ departmentName: "amazon.com", searchTerm: term, searchFrequencyRank: rank, clickedAsin: asin, clickShareRank: i + 1, clickShare: 0.2 - i * 0.05, conversionShare: 0.15 - i * 0.04 }),
    );
  for (let i = 0; i < 70_000; i++) push(`generic product ${i}`, 1000 + i, ["B0X000000A", "B0X000000B", "B0X000000C"]);
  push("magnetic tiles", 120, [RIVAL, OWN, "B0X000000D"]); // seed word match
  push("magnet tiles for toddlers", 950, ["B0X000000E", "B0X000000F", "B0X000000G"]); // seed word "magnet"
  push("unrelated toy blocks", 4000, ["B0X000000H", RIVAL, "B0X000000I"]); // kept: a competitor is a top click
  searchTermsGz = gzipSync(JSON.stringify({ reportSpecification: { reportType: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT" }, dataByDepartmentAndSearchTerm: rows }));
  return searchTermsGz;
}

function sqpDocument(asin) {
  return {
    reportSpecification: { reportType: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT" },
    dataByAsin: [
      {
        asin,
        searchQueryData: { searchQuery: "Magnetic Tiles", searchQueryScore: 1, searchQueryVolume: 5200 },
        impressionData: { totalQueryImpressionCount: 60000, asinImpressionCount: 3000, asinImpressionShare: 0.05 },
        clickData: { totalClickCount: 2100, asinClickCount: 150, totalMedianClickPrice: { amount: 29.99, currencyCode: "USD" }, asinMedianClickPrice: { amount: 24.49, currencyCode: "USD" } },
        cartAddData: { totalCartAddCount: 500, asinCartAddCount: 40 },
        purchaseData: { totalPurchaseCount: 210, asinPurchaseCount: 18, totalMedianPurchasePrice: { amount: 27.99, currencyCode: "USD" }, asinMedianPurchasePrice: { amount: 24.49, currencyCode: "USD" } },
      },
    ],
  };
}

function document(r) {
  switch (r.type) {
    case "GET_SALES_AND_TRAFFIC_REPORT":
      return { body: Buffer.from(JSON.stringify(salesAndTraffic(r.start.slice(0, 10)))), gzip: false };
    case "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL":
      return { body: Buffer.from(ordersFile()), gzip: false };
    case "GET_MERCHANT_LISTINGS_ALL_DATA":
      return { body: listingsFile(), gzip: false };
    case "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT":
      return { body: searchTermsDocument(), gzip: true };
    case "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT":
      return { body: gzipSync(JSON.stringify(sqpDocument(r.options?.asin))), gzip: true };
  }
  throw new Error(`no document for ${r.type}`);
}

const financePages = [
  {
    ShipmentEventList: [
      {
        AmazonOrderId: "111-0000001-0000001",
        PostedDate: "2026-10-02T10:00:00Z",
        MarketplaceName: "Amazon.com",
        ShipmentItemList: [
          {
            SellerSKU: "KB-60",
            QuantityShipped: 2,
            ItemChargeList: [
              { ChargeType: "Principal", ChargeAmount: { CurrencyCode: "USD", CurrencyAmount: 48.98 } },
              { ChargeType: "Tax", ChargeAmount: { CurrencyCode: "USD", CurrencyAmount: 3.92 } },
            ],
            ItemFeeList: [
              { FeeType: "Commission", FeeAmount: { CurrencyCode: "USD", CurrencyAmount: -7.35 } },
              { FeeType: "FBAPerUnitFulfillmentFee", FeeAmount: { CurrencyCode: "USD", CurrencyAmount: -11.36 } },
            ],
          },
        ],
      },
    ],
  },
  {
    RefundEventList: [
      {
        AmazonOrderId: "111-0000009-0000009",
        PostedDate: "2026-10-03T10:00:00Z",
        MarketplaceName: "Amazon.com",
        ShipmentItemAdjustmentList: [
          {
            SellerSKU: "KB-60",
            ItemChargeAdjustmentList: [{ ChargeType: "Principal", ChargeAmount: { CurrencyCode: "USD", CurrencyAmount: -24.49 } }],
            ItemFeeAdjustmentList: [{ FeeType: "Commission", FeeAmount: { CurrencyCode: "USD", CurrencyAmount: 2.94 } }],
          },
        ],
      },
    ],
    ServiceFeeEventList: [{ FeeReason: "FBAStorageFee", SellerSKU: "KB-60", FeeList: [{ FeeType: "FBAStorageFee", FeeAmount: { CurrencyCode: "USD", CurrencyAmount: -4.1 } }] }],
  },
];

function adsRows(r) {
  if (r.kind === "spSearchTerm") {
    return [
      { date: r.start, searchTerm: "Magnetic Tiles", keyword: "magnetic tiles", matchType: "EXACT", campaignName: "SP Exact", impressions: 1000, clicks: 20, cost: 18.5, purchases7d: 3, sales7d: 73.47, unitsSoldClicks7d: 3 },
      { date: r.end, searchTerm: "magnet blocks", keyword: "magnetic tiles", matchType: "BROAD", campaignName: "SP Broad", impressions: 400, clicks: 6, cost: 4.2, purchases7d: 0, sales7d: 0, unitsSoldClicks7d: 0 },
    ];
  }
  return [
    { date: r.start, advertisedAsin: OWN, advertisedSku: "KB-60", impressions: 1400, clicks: 26, cost: 22.7, purchases7d: 3, sales7d: 73.47, unitsSoldClicks7d: 3 },
    { date: r.start, advertisedAsin: OWN, advertisedSku: "KB-60-B", impressions: 100, clicks: 1, cost: 0.8, purchases7d: 0, sales7d: 0, unitsSoldClicks7d: 0 },
  ];
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, BASE);
    const p = url.pathname;
    const body = raw ? JSON.parse(raw.startsWith("{") || raw.startsWith("[") ? raw : "{}") : {};

    if (p === "/auth/o2/token") {
      // Login with Amazon: authorization-code exchange (Connect flow) or refresh.
      const form = new URLSearchParams(raw);
      if (form.get("client_id") !== "test-client" || form.get("client_secret") !== "test-secret") return json(res, 401, { error: "invalid_client", error_description: "Bad client credentials" });
      if (form.get("grant_type") === "authorization_code") {
        const code = form.get("code");
        if (!form.get("redirect_uri")) return json(res, 400, { error: "invalid_request", error_description: "redirect_uri missing" });
        if (code !== "SELLER-CODE" && code !== "ADS-CODE") return json(res, 400, { error: "invalid_grant", error_description: "Code expired" });
        log("token exchange", code, form.get("redirect_uri"));
        return json(res, 200, { access_token: "mock-token", refresh_token: code === "SELLER-CODE" ? "Atzr|seller-refresh" : "Atzr|ads-refresh", expires_in: 3600 });
      }
      if (!form.get("refresh_token")) return json(res, 400, { error: "invalid_grant", error_description: "No refresh token" });
      return json(res, 200, { access_token: "mock-token", expires_in: 3600 });
    }
    // Seller Central consent page and Login with Amazon authorize page: approve and send the user back.
    if (p === "/apps/authorize/consent" || p === "/ap/oa") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (p === "/ap/oa") back.searchParams.set("code", "ADS-CODE");
      else {
        back.searchParams.set("spapi_oauth_code", "SELLER-CODE");
        back.searchParams.set("selling_partner_id", "A1MOCKSELLER");
      }
      log("consent", p, "version=" + url.searchParams.get("version"));
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    // Lets the test ask what the mock saw.
    if (p === "/_stats") return json(res, 200, { throttledOnce, rejectedTopShare });
    if (!p.startsWith("/download") && !p.startsWith("/ads-download")) {
      const auth = req.headers["x-amz-access-token"] ?? req.headers.authorization;
      if (!String(auth).includes("mock-token")) return json(res, 403, { errors: [{ message: "Access denied" }] });
    }

    // ---- SP-API ----
    let m;
    if (p === "/sellers/v1/marketplaceParticipations") {
      log("marketplace participations");
      return json(res, 200, {
        payload: [
          { marketplace: { id: US, countryCode: "US", name: "Amazon.com", domainName: "www.amazon.com" }, participation: { isParticipating: true, hasSuspendedListings: false }, storeName: "KidBees" },
          { marketplace: { id: "A2EUQ1WTGCTBG2", countryCode: "CA", name: "Amazon.ca" }, participation: { isParticipating: false, hasSuspendedListings: false }, storeName: "KidBees" },
          { marketplace: { id: "A2Q3Y263D00KWC", countryCode: "BR", name: "Amazon.com.br" }, participation: { isParticipating: true, hasSuspendedListings: false }, storeName: "KidBees" },
        ],
      });
    }
    if ((m = p.match(/^\/catalog\/2022-04-01\/items\/(\w+)$/))) {
      log("catalog", m[1]);
      return json(res, 200, {
        asin: m[1],
        summaries: [{ marketplaceId: US, itemName: m[1] === OWN ? "KidBees 60pc Magnetic Tiles" : `Rival tiles ${m[1]}`, brand: m[1] === OWN ? "KidBees" : "RivalCo" }],
        images: [{ marketplaceId: US, images: [{ variant: "MAIN", link: `https://example.com/${m[1]}.jpg`, height: 500 }] }],
        salesRanks: [{ marketplaceId: US, displayGroupRanks: [{ title: "Toys & Games", rank: m[1] === OWN ? 1500 : 820 }], classificationRanks: [{ title: "Magnetic Building Sets", rank: 12 }] }],
      });
    }
    if (p === "/reports/2021-06-30/reports" && req.method === "POST") {
      if (body.reportType === "GET_SALES_AND_TRAFFIC_REPORT" && !throttledOnce) {
        throttledOnce = true;
        log("429 throttle (once)");
        return json(res, 429, { errors: [{ message: "Too many requests" }] }, { "Retry-After": "1" });
      }
      const id = `R${++seq}`;
      reports.set(id, { type: body.reportType, options: body.reportOptions, start: body.dataStartTime, end: body.dataEndTime, polls: 0 });
      log("createReport", body.reportType, body.dataStartTime?.slice(0, 10), JSON.stringify(body.reportOptions ?? {}));
      return json(res, 202, { reportId: id });
    }
    if ((m = p.match(/^\/reports\/2021-06-30\/reports\/(\w+)$/))) {
      const r = reports.get(m[1]);
      if (!r) return json(res, 404, { errors: [{ message: "Not found" }] });
      r.polls++;
      return json(res, 200, { reportId: m[1], processingStatus: r.polls < 2 ? "IN_PROGRESS" : "DONE", ...(r.polls < 2 ? {} : { reportDocumentId: `D${m[1]}` }) });
    }
    if ((m = p.match(/^\/reports\/2021-06-30\/documents\/D(\w+)$/))) {
      const doc = document(reports.get(m[1]));
      return json(res, 200, { reportDocumentId: `D${m[1]}`, url: `${BASE}/download/${m[1]}`, ...(doc.gzip ? { compressionAlgorithm: "GZIP" } : {}) });
    }
    if ((m = p.match(/^\/download\/(\w+)$/))) {
      res.writeHead(200);
      return res.end(document(reports.get(m[1])).body);
    }
    if (p === "/finances/2024-06-19/transactions") {
      // Account-level charges as Amazon reports them (fees negative), plus an order payment that must be ignored.
      const tx = (id, transactionType, description, amount, day) => ({
        transactionId: id,
        transactionType,
        description,
        postedDate: `2026-09-${day}T10:00:00Z`,
        totalAmount: { currencyAmount: amount, currencyCode: "USD" },
        marketplaceDetails: { marketplaceId: US },
      });
      const second = url.searchParams.get("nextToken") === "tx2";
      log("transactions page", second ? 2 : 1);
      return json(res, 200, {
        payload: second
          ? { transactions: [tx("T5", "DebtRecovery", "DebtPayment", 39.99, "21"), tx("T6", "FBAInventoryReimbursement", "WAREHOUSE_DAMAGE", 7.55, "12")] }
          : {
              nextToken: "tx2",
              transactions: [
                tx("T1", "ServiceFee", "Subscription", -39.99, "21"),
                tx("T2", "ServiceFee", "FBAStorageBilling", -0.53, "07"),
                tx("T3", "ServiceFee", "FBAInboundConvenience", -82, "13"),
                tx("T4", "Shipment", "Order Payment", 20.5, "14"),
                tx("T7", "ServiceFee", "CouponParticipationEvent", -5, "21"),
              ],
            },
      });
    }
    if (p === "/finances/v0/financialEvents" && (url.searchParams.get("PostedBefore") ?? "9") < "2026-10-01") {
      return json(res, 200, { payload: { FinancialEvents: {} } }); // nothing posted that early
    }
    if (p === "/finances/v0/financialEvents") {
      const page = url.searchParams.get("NextToken") === "page2" ? 1 : 0;
      log("finances page", page + 1);
      return json(res, 200, { payload: { FinancialEvents: financePages[page], ...(page === 0 ? { NextToken: "page2" } : {}) } });
    }
    if (p === "/fba/inventory/v1/summaries") {
      const second = url.searchParams.get("nextToken") === "inv2";
      log("inventory page", second ? 2 : 1);
      const summary = (sku, asin, f) => ({
        asin,
        sellerSku: sku,
        totalQuantity: f + 20,
        inventoryDetails: {
          fulfillableQuantity: f,
          inboundWorkingQuantity: 5,
          inboundShippedQuantity: 10,
          inboundReceivingQuantity: 0,
          reservedQuantity: { totalReservedQuantity: 3 },
          unfulfillableQuantity: { totalUnfulfillableQuantity: 2 },
        },
      });
      return json(res, 200, {
        payload: { inventorySummaries: second ? [summary("KB-60-B", OWN, 40)] : [summary("KB-60", OWN, 300)] },
        ...(second ? {} : { pagination: { nextToken: "inv2" } }),
      });
    }
    if (p === "/products/pricing/v0/price") {
      const skus = (url.searchParams.get("Skus") ?? "").split(",");
      log("my prices", skus.join(","));
      const regular = { "KB-60": 24.49, "KB-60-M": 26.99, "KB-100": 39.99 };
      return json(res, 200, {
        payload: skus.map((sku) => ({
          status: "Success",
          SellerSKU: sku,
          Product: {
            Offers: [
              {
                SellerSKU: sku,
                // KB-60 is on sale.
                BuyingPrice: { ListingPrice: { CurrencyCode: "USD", Amount: sku === "KB-60" ? 20.99 : regular[sku] } },
                RegularPrice: { CurrencyCode: "USD", Amount: regular[sku] },
              },
            ],
          },
        })),
      });
    }
    if (p === "/products/fees/v0/feesEstimate" && req.method === "POST") {
      log("fee estimates", body.length);
      return json(
        res,
        200,
        body.map((r) => {
          const price = r.FeesEstimateRequest.PriceToEstimateFees.ListingPrice.Amount;
          const referral = Math.round(price * 15) / 100;
          const fba = r.FeesEstimateRequest.IsAmazonFulfilled ? 5.68 : 0;
          return {
            Status: "Success",
            FeesEstimateIdentifier: { IdType: r.IdType, IdValue: r.IdValue, IsAmazonFulfilled: r.FeesEstimateRequest.IsAmazonFulfilled },
            FeesEstimate: {
              TotalFeesEstimate: { CurrencyCode: "USD", Amount: Math.round((referral + fba) * 100) / 100 },
              FeeDetailList: [
                { FeeType: "ReferralFee", FinalFee: { CurrencyCode: "USD", Amount: referral } },
                { FeeType: "VariableClosingFee", FinalFee: { CurrencyCode: "USD", Amount: 0 } },
                { FeeType: "PerItemFee", FinalFee: { CurrencyCode: "USD", Amount: 0 } },
                { FeeType: "FBAFees", FinalFee: { CurrencyCode: "USD", Amount: fba } },
              ],
            },
          };
        }),
      );
    }
    if (p === "/batches/products/pricing/v0/itemOffers") {
      log("offers", body.requests.length);
      return json(res, 200, {
        responses: body.requests.map((r) => {
          const asin = r.uri.split("/")[5];
          return {
            status: { statusCode: 200 },
            body: {
              payload: {
                ASIN: asin,
                Summary: {
                  TotalOfferCount: asin === OWN ? 1 : 4,
                  BuyBoxPrices: [{ condition: "New", LandedPrice: { CurrencyCode: "USD", Amount: asin === OWN ? 24.49 : 21.99 } }],
                  LowestPrices: [{ condition: "new", fulfillmentChannel: "Amazon", LandedPrice: { CurrencyCode: "USD", Amount: asin === OWN ? 24.49 : 20.5 } }],
                },
                Offers: [{ MyOffer: asin === OWN, IsBuyBoxWinner: true }],
              },
            },
          };
        }),
      });
    }

    // ---- Amazon Ads ----
    if (p === "/v2/profiles") {
      return json(res, 200, [
        { profileId: 999, countryCode: "CA", currencyCode: "CAD", accountInfo: { type: "seller", marketplaceStringId: "A2EUQ1WTGCTBG2" } },
        { profileId: 111, countryCode: "US", currencyCode: "USD", accountInfo: { type: "seller", marketplaceStringId: US } },
      ]);
    }
    if (p === "/reporting/reports" && req.method === "POST") {
      if (req.headers["amazon-advertising-api-scope"] !== "111") return json(res, 401, { message: "bad scope" });
      const cfg = body.configuration;
      if (cfg.columns.includes("topOfSearchImpressionShare") && !rejectedTopShare) {
        rejectedTopShare = true;
        log("ads 400 for topOfSearchImpressionShare (once)");
        return json(res, 400, { code: "400", detail: "configuration columns contains invalid values: topOfSearchImpressionShare" });
      }
      const id = `0000000${++seq}`.slice(-8) + "-0000-4000-8000-000000000000";
      adsReports.set(id, { kind: cfg.reportTypeId, start: body.startDate, end: body.endDate, polls: 0 });
      log("ads createReport", cfg.reportTypeId, body.startDate, body.endDate);
      return json(res, 200, { reportId: id, status: "PENDING" });
    }
    if ((m = p.match(/^\/reporting\/reports\/([\w-]+)$/))) {
      const r = adsReports.get(m[1]);
      r.polls++;
      return json(res, 200, { reportId: m[1], status: r.polls < 2 ? "PROCESSING" : "COMPLETED", ...(r.polls < 2 ? {} : { url: `${BASE}/ads-download/${m[1]}` }) });
    }
    if ((m = p.match(/^\/ads-download\/([\w-]+)$/))) {
      res.writeHead(200);
      return res.end(gzipSync(JSON.stringify(adsRows(adsReports.get(m[1])))));
    }

    json(res, 404, { errors: [{ message: `mock: no route for ${req.method} ${p}` }] });
  });
});

server.listen(PORT, () => log(`listening on ${BASE}`));
