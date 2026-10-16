import "server-only";
import { connection } from "next/server";
import { cogsBetween, currentUnitCost, fifo, hasShipments } from "./cogs";
import { db } from "./db";
import { marketplaces, type MarketplaceCode } from "./marketplaces";
import { ymd, type Period } from "./periods";

// The Products table: one row per product (ASIN) in a marketplace, with the listing, stock and price up
// front and a period's sales, traffic, ads, promotions and fees for the expanded row.

type Listing = {
  sku: string;
  asin: string;
  title: string;
  status: string;
  fulfillment: string;
  price: number | null;
  regular_price: number | null;
  sale_price: number | null;
  referral_fee: number | null;
  fba_fee: number | null;
  total_fee: number | null;
  open_date: string | null;
  currency: string;
  source: string;
};

export type ProductRowData = {
  id: number;
  asin: string;
  title: string;
  imageUrl: string | null;
  /** "Active", "Inactive", "Incomplete"…, or null when SellerDoos hasn't seen a listing for it. */
  status: string | null;
  fba: boolean;
  skus: { sku: string; status: string; fba: boolean }[];
  openDate: string | null;
  currency: string;
  price: number | null;
  regularPrice: number | null;
  salePrice: number | null;
  fees: { referral: number | null; fba: number | null; total: number | null };
  /** Landed cost of the next unit sold (from shipments), or the unit cost entered on the product. */
  unitCost: number | null;
  /** Shipment the next unit comes from ("KB_003"); null when the cost was entered by hand. */
  costRef: string | null;
  /** Price after Amazon's fees and the unit cost (when known). */
  netPerUnit: number | null;
  inventory: { fulfillable: number; inbound: number; reserved: number; unfulfillable: number; date: string } | null;
  /** Days the fulfillable stock lasts at the last 30 days' pace. */
  daysOfCover: number | null;
  bsr: { rank: number; category: string } | null;
  buyBox: { price: number | null; yours: boolean | null } | null;
  sales: {
    units: number;
    orders: number;
    revenue: number;
    promoOrders: number;
    promoDiscount: number;
    promoIds: string[];
    /** Cost of the units sold in the period (null when no cost is known). */
    cogs: number | null;
    /** Revenue − estimated Amazon fees − cost of goods − ad spend. */
    profit: number | null;
  };
  traffic: { sessions: number; pageViews: number; conversion: number | null; buyBoxPct: number | null; days: number } | null;
  ads: { spend: number; sales: number; clicks: number; impressions: number; acos: number | null; tacos: number | null } | null;
};

/** Marketplaces that have products, most products first. */
export async function productMarketplaces() {
  await connection();
  const rows = db.prepare("SELECT marketplace, COUNT(*) n FROM products GROUP BY marketplace ORDER BY n DESC").all() as { marketplace: MarketplaceCode }[];
  return rows.map((r) => r.marketplace).filter((m) => m in marketplaces);
}

const isFba = (fulfillment: string) => fulfillment !== "" && fulfillment.toUpperCase() !== "DEFAULT";
const statusOrder = ["Active", "Inactive", "Incomplete"];

export async function getProductTable(period: Period, marketplace: MarketplaceCode) {
  await connection();
  const products = db
    .prepare("SELECT id, asin, title, image_url, unit_cost FROM products WHERE marketplace = ? ORDER BY id")
    .all(marketplace) as { id: number; asin: string; title: string | null; image_url: string | null; unit_cost: number | null }[];

  const listings = db.prepare("SELECT * FROM listings WHERE marketplace = ?").all(marketplace) as Listing[];
  const byAsin = new Map<string, Listing[]>();
  for (const l of listings) byAsin.set(l.asin, [...(byAsin.get(l.asin) ?? []), l]);

  // Latest inventory snapshot, summed over SKUs.
  const invDate = (db.prepare("SELECT MAX(date) d FROM inventory_snapshots WHERE marketplace = ?").get(marketplace) as { d: string | null }).d;
  const inventory = new Map(
    (
      db
        .prepare(
          `SELECT asin, SUM(fulfillable) fulfillable, SUM(inbound) inbound, SUM(reserved) reserved, SUM(unfulfillable) unfulfillable
           FROM inventory_snapshots WHERE marketplace = ? AND date = ? GROUP BY asin`,
        )
        .all(marketplace, invDate ?? "") as { asin: string; fulfillable: number; inbound: number; reserved: number; unfulfillable: number }[]
    ).map((r) => [r.asin, r]),
  );

  // Orders in the period (purchase dates carry offsets, so compare as timestamps).
  const orderRows = (
    db
      .prepare(
        "SELECT order_id, asin, qty, item_price, promo_discount, promo_ids, purchase_date FROM orders WHERE marketplace = ? AND status != 'Cancelled' AND purchase_date >= ?",
      )
      .all(marketplace, ymd(new Date(Math.min(period.start.getTime(), Date.now() - 30 * 86_400_000) - 86_400_000))) as {
      order_id: string;
      asin: string;
      qty: number;
      item_price: number;
      promo_discount: number;
      promo_ids: string;
      purchase_date: string;
    }[]
  ).map((r) => ({ ...r, at: Date.parse(r.purchase_date) }));
  const inPeriod = orderRows.filter((r) => r.at >= period.start.getTime() && r.at < period.end.getTime());
  const last30 = orderRows.filter((r) => r.at >= Date.now() - 30 * 86_400_000);

  // Daily tables: a day counts when it starts inside the period.
  const dayStart = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate());
  const days = { from: ymd(dayStart), to: ymd(new Date(period.end.getTime() - 1)) };
  const traffic = new Map(
    (
      db
        .prepare(
          `SELECT asin, SUM(sessions) sessions, SUM(page_views) page_views, SUM(units) units, AVG(buy_box_pct) buy_box, COUNT(*) days
           FROM sales_traffic WHERE marketplace = ? AND date BETWEEN ? AND ? GROUP BY asin`,
        )
        .all(marketplace, days.from, days.to) as { asin: string; sessions: number; page_views: number; units: number; buy_box: number | null; days: number }[]
    ).map((r) => [r.asin, r]),
  );
  const ads = new Map(
    (
      db
        .prepare(
          `SELECT asin, SUM(cost) cost, SUM(sales) sales, SUM(clicks) clicks, SUM(impressions) impressions
           FROM ads_products WHERE marketplace = ? AND date BETWEEN ? AND ? AND source != 'demo' GROUP BY asin`,
        )
        .all(marketplace, days.from, days.to) as { asin: string; cost: number; sales: number; clicks: number; impressions: number }[]
    ).map((r) => [r.asin, r]),
  );
  // Only real ad data: the table's profit subtracts ad spend, and sample numbers would make it up.
  const hasAds = Boolean(db.prepare("SELECT 1 FROM ads_products WHERE marketplace = ? AND source != 'demo' LIMIT 1").get(marketplace));

  const latestSnapshot = db.prepare(
    "SELECT bsr, bsr_category, buy_box_price, you_have_buy_box FROM listing_snapshots WHERE marketplace = ? AND asin = ? ORDER BY date DESC LIMIT 1",
  );
  const latestBsr = db.prepare(
    "SELECT category, rank FROM bsr_snapshots WHERE product_id = ? AND checked_on = (SELECT MAX(checked_on) FROM bsr_snapshots WHERE product_id = ?) ORDER BY rowid LIMIT 1",
  );

  const rows: ProductRowData[] = products.map((p) => {
    const own = (byAsin.get(p.asin) ?? []).sort(
      (a, b) => rank(a.status) - rank(b.status) || Number(isFba(b.fulfillment)) - Number(isFba(a.fulfillment)),
    );
    // The "main" SKU: active first, FBA before merchant-fulfilled.
    const main = own[0];
    const price = main ? (main.sale_price ?? main.regular_price ?? main.price) : null;
    const inv = inventory.get(p.asin);
    const sold30 = last30.filter((o) => o.asin === p.asin).reduce((s, o) => s + o.qty, 0);
    const mine = inPeriod.filter((o) => o.asin === p.asin);
    const revenue = mine.reduce((s, o) => s + o.item_price, 0);
    const promo = mine.filter((o) => o.promo_discount > 0);
    const t = traffic.get(p.asin);
    const a = ads.get(p.asin);
    const snap = latestSnapshot.get(marketplace, p.asin) as
      | { bsr: number | null; bsr_category: string | null; buy_box_price: number | null; you_have_buy_box: number | null }
      | undefined;
    const bsrRow = latestBsr.get(p.id, p.id) as { category: string; rank: number } | undefined;
    const totalFee = main?.total_fee ?? null;

    // Cost of goods: shipments first-in, first-out, else the manual unit cost.
    let unitCost = p.unit_cost;
    let costRef: string | null = null;
    let periodCogs: number | null = null;
    const units = mine.reduce((s, o) => s + o.qty, 0);
    if (hasShipments(p.asin)) {
      const result = fifo(p.asin);
      const next = currentUnitCost(result);
      unitCost = next?.unitCost ?? null;
      costRef = next?.ref ?? null;
      periodCogs = cogsBetween(result, period.start.getTime(), period.end.getTime()).cost;
    } else if (unitCost != null) {
      periodCogs = unitCost * units;
    }
    // Amazon fees for the period, estimated from today's per-unit estimate: FBA fee per unit plus the
    // referral fee as a share of price.
    const estFees =
      main && price && main.total_fee != null ? units * (main.fba_fee ?? 0) + revenue * ((main.referral_fee ?? 0) / price) : null;
    const adSpend = ads.get(p.asin)?.cost ?? 0;

    return {
      id: p.id,
      asin: p.asin,
      title: p.title ?? main?.title ?? p.asin,
      imageUrl: p.image_url,
      status: main?.status || null,
      fba: own.some((l) => isFba(l.fulfillment)),
      skus: own.map((l) => ({ sku: l.sku, status: l.status, fba: isFba(l.fulfillment) })),
      openDate: main?.open_date ?? null,
      currency: main?.currency || marketplaces[marketplace].currency,
      price,
      regularPrice: main?.regular_price ?? main?.price ?? null,
      salePrice: main?.sale_price ?? null,
      fees: { referral: main?.referral_fee ?? null, fba: main?.fba_fee ?? null, total: totalFee },
      unitCost,
      costRef,
      netPerUnit: price != null && totalFee != null ? price - totalFee - (unitCost ?? 0) : null,
      inventory: inv && invDate ? { ...inv, date: invDate } : null,
      daysOfCover: inv && sold30 > 0 ? Math.floor(inv.fulfillable / (sold30 / 30)) : null,
      bsr: bsrRow ? { rank: bsrRow.rank, category: bsrRow.category } : snap?.bsr ? { rank: snap.bsr, category: snap.bsr_category ?? "" } : null,
      buyBox: snap && snap.buy_box_price != null ? { price: snap.buy_box_price, yours: snap.you_have_buy_box == null ? null : snap.you_have_buy_box === 1 } : null,
      sales: {
        units,
        cogs: periodCogs,
        profit: periodCogs != null && estFees != null ? revenue - estFees - periodCogs - adSpend : null,
        orders: new Set(mine.map((o) => o.order_id)).size,
        revenue,
        promoOrders: new Set(promo.map((o) => o.order_id)).size,
        promoDiscount: promo.reduce((s, o) => s + o.promo_discount, 0),
        promoIds: [...new Set(promo.flatMap((o) => o.promo_ids.split(/[,;]/).map((x) => x.trim()).filter(Boolean)))].slice(0, 5),
      },
      traffic: t
        ? { sessions: t.sessions, pageViews: t.page_views, conversion: t.sessions ? t.units / t.sessions : null, buyBoxPct: t.buy_box, days: t.days }
        : null,
      ads: hasAds
        ? {
            spend: a?.cost ?? 0,
            sales: a?.sales ?? 0,
            clicks: a?.clicks ?? 0,
            impressions: a?.impressions ?? 0,
            acos: a?.sales ? a.cost / a.sales : null,
            tacos: revenue ? (a?.cost ?? 0) / revenue : null,
          }
        : null,
    };
  });

  // Active first, then by units sold in the period.
  rows.sort((x, y) => rank(x.status) - rank(y.status) || y.sales.units - x.sales.units || x.id - y.id);
  return {
    rows,
    currency: marketplaces[marketplace].currency,
    hasListings: listings.length > 0,
    demo: listings.some((l) => l.source === "demo"),
    listingsUpdatedAt: (db.prepare("SELECT MAX(updated_at) t FROM listings WHERE marketplace = ?").get(marketplace) as { t: string | null }).t,
  };
}

function rank(status: string | null) {
  const i = status ? statusOrder.indexOf(status) : -1;
  return i === -1 ? (status ? statusOrder.length : statusOrder.length + 1) : i;
}

export type ProductTable = Awaited<ReturnType<typeof getProductTable>>;
