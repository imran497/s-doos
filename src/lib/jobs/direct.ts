import { getCatalogItem, getFeeEstimates, getInventory, getMarketplaceParticipations, getMyPrices, getOffers, isSpApiConfigured, listFinancialEvents, type Participation } from "../amazon/spapi";
import { addDays, db, today } from "../db";
import { marketplaces, type MarketplaceCode } from "../marketplaces";
import { snapshotCatalog } from "./ranks";

// Jobs that call SP-API directly (no report queue): FBA inventory, finance events, and daily
// BSR + offer snapshots for your products and watched competitors.

/** Marketplaces you track products in (product-level data: BSR, offers, SQP). */
export const activeMarketplaces = () =>
  (db.prepare("SELECT DISTINCT marketplace FROM products").all() as { marketplace: MarketplaceCode }[]).map((r) => r.marketplace);

/** The connected seller account's marketplaces, remembered for a day (Amazon allows ~1 lookup a minute). */
export async function sellerMarketplaces({ refresh = false } = {}): Promise<Participation[]> {
  const cached = db.prepare("SELECT value FROM settings WHERE key = 'spapi:marketplaces'").get() as { value: string } | undefined;
  const at = db.prepare("SELECT value FROM settings WHERE key = 'spapi:marketplacesAt'").get() as { value: string } | undefined;
  if (cached && at && !refresh && Date.now() - Number(at.value) < 86_400_000) return JSON.parse(cached.value) as Participation[];
  const found = await getMarketplaceParticipations();
  const save = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  save.run("spapi:marketplaces", JSON.stringify(found));
  save.run("spapi:marketplacesAt", String(Date.now()));
  return found;
}

/** Marketplaces to pull account-wide data for: where the seller account sells, plus any product marketplace. */
export async function accountMarketplaces() {
  const fromAccount = isSpApiConfigured() ? (await sellerMarketplaces()).map((p) => p.code) : [];
  return [...new Set([...fromAccount, ...activeMarketplaces()])];
}

export async function snapshotInventory(m: MarketplaceCode) {
  const rows = await getInventory(m);
  const date = today();
  const save = db.prepare(`
    INSERT INTO inventory_snapshots (marketplace, date, sku, asin, fulfillable, inbound, reserved, unfulfillable, source)
    VALUES (@m, @date, @sku, @asin, @fulfillable, @inbound, @reserved, @unfulfillable, 'spapi')
    ON CONFLICT(marketplace, date, sku) DO UPDATE SET fulfillable = excluded.fulfillable, inbound = excluded.inbound,
      reserved = excluded.reserved, unfulfillable = excluded.unfulfillable, asin = excluded.asin, source = 'spapi'`);
  const map = db.prepare("INSERT INTO sku_map (sku, asin) VALUES (?, ?) ON CONFLICT(sku) DO UPDATE SET asin = excluded.asin");
  db.transaction(() => {
    for (const r of rows) {
      if (!r.sku) continue;
      save.run({ m, date, ...r });
      if (r.asin) map.run(r.sku, r.asin);
    }
  })();
  return rows.length;
}

/**
 * Re-imports finance events posted between `from` and `to` (default: the last 14 days). Amazon returns events for the whole region
 * (e.g. all EU marketplaces) and keeps adjusting recent orders, so the window is replaced for every
 * marketplace in the region. Call once per region.
 */
export async function syncFinances(m: MarketplaceCode, region: MarketplaceCode[], from = addDays(today(), -14), to = today()) {
  // Only what was posted in the window (events with no date of their own are dated at its end).
  const rows = (await listFinancialEvents(m, from, to)).filter((r) => r.postedDate >= from && r.postedDate <= to);
  const byName = (name: string | null) =>
    (Object.entries(marketplaces).find(([, info]) => name && info.domain === name.toLowerCase())?.[0] as MarketplaceCode | undefined) ?? m;
  const asinOf = db.prepare("SELECT asin FROM sku_map WHERE sku = ?");

  db.transaction(() => {
    const remove = db.prepare("DELETE FROM fee_events WHERE marketplace = ? AND posted_date BETWEEN ? AND ? AND source = 'spapi'");
    for (const code of region) remove.run(code, from, to);
    const save = db.prepare(`
      INSERT INTO fee_events (marketplace, posted_date, order_id, sku, asin, kind, detail, amount, currency, qty, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'spapi')`);
    for (const r of rows) {
      const asin = r.asin ?? (r.sku ? ((asinOf.get(r.sku) as { asin: string } | undefined)?.asin ?? null) : null);
      save.run(byName(r.marketplaceName), r.postedDate, r.orderId, r.sku, asin, r.kind, r.detail, r.amount, r.currency, r.qty);
    }
  })();
  return rows.length;
}

/** Today's BSR (catalog) and Buy Box / offers (pricing) for your products and their competitors. */
export async function snapshotListings(m: MarketplaceCode) {
  const own = db.prepare("SELECT id, asin FROM products WHERE marketplace = ?").all(m) as { id: number; asin: string }[];
  const rivals = db
    .prepare("SELECT c.id, c.asin FROM competitors c JOIN products p ON p.id = c.product_id WHERE p.marketplace = ?")
    .all(m) as { id: number; asin: string }[];
  const date = today();
  const errors: string[] = [];
  const save = db.prepare(`
    INSERT INTO listing_snapshots (marketplace, asin, date, bsr, bsr_category, buy_box_price, lowest_price, currency, offer_count, you_have_buy_box, source)
    VALUES (@m, @asin, @date, @bsr, @category, @buyBox, @lowest, @currency, @offers, @youHaveBuyBox, 'spapi')
    ON CONFLICT(marketplace, asin, date) DO UPDATE SET
      bsr = COALESCE(excluded.bsr, bsr), bsr_category = COALESCE(excluded.bsr_category, bsr_category),
      buy_box_price = COALESCE(excluded.buy_box_price, buy_box_price), lowest_price = COALESCE(excluded.lowest_price, lowest_price),
      currency = excluded.currency, offer_count = COALESCE(excluded.offer_count, offer_count),
      you_have_buy_box = COALESCE(excluded.you_have_buy_box, you_have_buy_box), source = 'spapi'`);
  const blank = { bsr: null, category: null, buyBox: null, lowest: null, currency: "", offers: null, youHaveBuyBox: null };

  // Competitors need a catalog call for BSR, title and image; your own products get it in the rank check.
  for (const c of rivals) {
    try {
      const item = await getCatalogItem(c.asin, m);
      db.prepare("UPDATE competitors SET title = COALESCE(?, title), brand = COALESCE(?, brand), image_url = COALESCE(?, image_url) WHERE id = ?").run(
        item.title ?? null,
        item.brand ?? null,
        item.imageUrl ?? null,
        c.id,
      );
      save.run({ ...blank, m, asin: c.asin, date, bsr: item.bsr[0]?.rank ?? null, category: item.bsr[0]?.category ?? null });
    } catch (error) {
      errors.push(`Catalog ${c.asin}: ${(error as Error).message}`);
    }
  }
  for (const p of own) {
    const top = db.prepare("SELECT category, rank FROM bsr_snapshots WHERE product_id = ? AND checked_on = ? ORDER BY rowid LIMIT 1").get(p.id, date) as
      | { category: string; rank: number }
      | undefined;
    if (top) save.run({ ...blank, m, asin: p.asin, date, bsr: top.rank, category: top.category });
  }

  const asins = [...new Set([...own, ...rivals].map((x) => x.asin))];
  try {
    for (const o of await getOffers(m, asins)) {
      save.run({ ...blank, m, asin: o.asin, date, buyBox: o.buyBoxPrice, lowest: o.lowestPrice, currency: o.currency, offers: o.offerCount, youHaveBuyBox: o.youHaveBuyBox ? 1 : 0 });
    }
  } catch (error) {
    errors.push(`Offers: ${(error as Error).message}`);
  }
  return { asins: asins.length, errors };
}

/**
 * Current prices (with any sale price) and Amazon's fee estimate for listings not refreshed today, plus
 * title, image and BSR for products that don't have an image yet. Cheap to call often: only stale rows
 * are fetched.
 */
export async function refreshListingDetails() {
  const errors: string[] = [];
  const date = today();
  const stale = db
    .prepare("SELECT marketplace, sku, fulfillment, price, currency FROM listings WHERE source = 'spapi' AND (fees_at IS NULL OR fees_at < ?)")
    .all(date) as { marketplace: MarketplaceCode; sku: string; fulfillment: string; price: number | null; currency: string }[];
  const byMarket = new Map<MarketplaceCode, typeof stale>();
  for (const r of stale) byMarket.set(r.marketplace, [...(byMarket.get(r.marketplace) ?? []), r]);

  for (const [m, rows] of byMarket) {
    try {
      const savePrice = db.prepare("UPDATE listings SET regular_price = ?, sale_price = ?, currency = COALESCE(NULLIF(?, ''), currency) WHERE marketplace = ? AND sku = ?");
      for (const p of await getMyPrices(m, rows.map((r) => r.sku))) savePrice.run(p.regularPrice, p.salePrice, p.currency, m, p.sku);
    } catch (error) {
      errors.push(`Prices ${m}: ${(error as Error).message}`);
    }
    try {
      const priced = db
        .prepare(`SELECT sku, fulfillment, COALESCE(sale_price, regular_price, price) price, currency FROM listings WHERE marketplace = ? AND sku IN (${rows.map(() => "?").join(",")})`)
        .all(m, ...rows.map((r) => r.sku)) as { sku: string; fulfillment: string; price: number | null; currency: string }[];
      const items = priced
        .filter((r) => r.price != null && r.price > 0)
        .map((r) => ({ sku: r.sku, price: r.price!, currency: r.currency || marketplaces[m].currency, fba: r.fulfillment !== "" && r.fulfillment !== "DEFAULT" }));
      const saveFees = db.prepare("UPDATE listings SET referral_fee = ?, fba_fee = ?, total_fee = ?, fees_at = ? WHERE marketplace = ? AND sku = ?");
      for (const f of await getFeeEstimates(m, items)) saveFees.run(f.referralFee, f.fbaFee, f.totalFee, date, m, f.sku);
      // Listings without a price (or whose estimate failed) aren't retried until tomorrow.
      db.prepare(`UPDATE listings SET fees_at = ? WHERE marketplace = ? AND fees_at IS NULL AND sku IN (${rows.map(() => "?").join(",")})`).run(date, m, ...rows.map((r) => r.sku));
    } catch (error) {
      errors.push(`Fees ${m}: ${(error as Error).message}`);
    }
  }

  const bare = db.prepare("SELECT id, asin, marketplace FROM products WHERE image_url IS NULL LIMIT 20").all() as { id: number; asin: string; marketplace: MarketplaceCode }[];
  for (const p of bare) {
    try {
      await snapshotCatalog(p);
    } catch (error) {
      errors.push(`Catalog ${p.asin}: ${(error as Error).message}`);
    }
  }
  return { refreshed: stale.length, errors };
}

/**
 * One-time history: finance events back to the first shipment (at most 18 months), so the Summary's payout
 * covers every sale. Amazon allows 180 days per request. Remembers how far back it has gone.
 */
export async function backfillFinances(m: MarketplaceCode, region: MarketplaceCode[]) {
  const key = `finances:backfilledFrom:${marketplaces[m].region}`;
  const done = (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  const firstShipment = (db.prepare("SELECT MIN(order_date) d FROM shipments").get() as { d: string | null }).d;
  const floor = addDays(today(), -540);
  const target = firstShipment && firstShipment > floor ? addDays(firstShipment, -7) : floor;
  if (done && done <= target) return 0;
  // Everything after the regular 14-day window, oldest first, up to where a previous backfill started.
  const until = done ?? addDays(today(), -15);
  let stored = 0;
  for (let start = target; start <= until; start = addDays(start, 180)) {
    const end = addDays(start, 179) < until ? addDays(start, 179) : until;
    stored += await syncFinances(m, region, start, end);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, target);
  return stored;
}
