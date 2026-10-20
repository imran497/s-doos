import { currentUnitCost, fifo, hasShipments } from "./cogs";
import "server-only";
import { connection } from "next/server";
import { addDays, db, today } from "./db";
import { marketplaces, type MarketplaceCode } from "./marketplaces";
import { formatMoney } from "./metrics";
import { dailyProfit, productProfit } from "./profit";
import { getSettings } from "./settings";

// Read queries for the Amazon API screens: sales & profit, ads, competitors, research and business.
// Each awaits connection() so results are read per request (synchronous SQLite under Cache Components).

type ProductRef = { id: number; asin: string; marketplace: MarketplaceCode; unit_cost: number | null };

const productRef = (id: number) => db.prepare("SELECT id, asin, marketplace, unit_cost FROM products WHERE id = ?").get(id) as ProductRef | undefined;

export const rangeDates = (days: number, end = addDays(today(), -1)) => Array.from({ length: days }, (_, i) => addDays(end, -(days - 1) + i));

const ratio = (a: number, b: number) => (b ? a / b : null);
const change = (now: number, before: number) => (before ? (now - before) / before : null);

/** Stock on hand for an ASIN and how many days it lasts at the recent sales pace. */
function stockFor(asin: string, m: MarketplaceCode) {
  const latest = db.prepare("SELECT MAX(date) d FROM inventory_snapshots WHERE asin = ? AND marketplace = ?").get(asin, m) as { d: string | null };
  if (!latest.d) return null;
  const s = db
    .prepare("SELECT SUM(fulfillable) fulfillable, SUM(inbound) inbound, SUM(reserved) reserved FROM inventory_snapshots WHERE asin = ? AND marketplace = ? AND date = ?")
    .get(asin, m, latest.d) as { fulfillable: number; inbound: number; reserved: number };
  const pace = db
    .prepare("SELECT COALESCE(SUM(units), 0) / 14.0 v FROM sales_traffic WHERE asin = ? AND marketplace = ? AND date > ?")
    .get(asin, m, addDays(today(), -15)) as { v: number };
  const daysOfCover = pace.v > 0 ? Math.floor(s.fulfillable / pace.v) : null;
  return { ...s, asOf: latest.d, dailyUnits: pace.v, daysOfCover, low: daysOfCover != null && daysOfCover < getSettings().lowStockDays };
}

// ---- Sales & profit ----

/** A date range (yyyy-mm-dd, inclusive) as a list of days, plus the same number of days just before it. */
export type DateRange = { from: string; to: string };
function rangeAndBefore(range: DateRange) {
  const dates = datesBetween(range.from, range.to);
  const prevDates = datesBetween(addDays(range.from, -dates.length), addDays(range.from, -1));
  return { dates, prevDates };
}

export async function getSalesDetail(productId: number, range: DateRange) {
  await connection();
  const p = productRef(productId);
  if (!p) return null;
  const { dates, prevDates } = rangeAndBefore(range);
  const rows = db
    .prepare("SELECT * FROM sales_traffic WHERE asin = ? AND marketplace = ? AND date BETWEEN ? AND ?")
    .all(p.asin, p.marketplace, prevDates[0], dates.at(-1)) as {
    date: string;
    units: number;
    revenue: number;
    currency: string;
    sessions: number;
    page_views: number;
    buy_box_pct: number | null;
  }[];
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const total = (list: string[]) => {
    const r = list.map((d) => byDate.get(d)).filter(Boolean) as typeof rows;
    const units = r.reduce((s, x) => s + x.units, 0);
    const sessions = r.reduce((s, x) => s + x.sessions, 0);
    return { units, revenue: r.reduce((s, x) => s + x.revenue, 0), sessions, conversion: ratio(units, sessions), days: r.length };
  };
  const now = total(dates);
  const before = total(prevDates);

  return {
    /** The days shown and the ones before them, for comparing. */
    range: { from: dates[0], to: dates.at(-1)!, prevFrom: prevDates[0], prevTo: prevDates.at(-1)! },
    hasData: rows.length > 0,
    currency: rows.find((r) => r.currency)?.currency || marketplaces[p.marketplace].currency,
    unitCost: p.unit_cost,
    /** Cost of the next unit sold, from shipments (null when the product has none). */
    shipmentCost: hasShipments(p.asin) ? currentUnitCost(fifo(p.asin)) : null,
    dates,
    series: dates.map((d) => {
      const r = byDate.get(d);
      return { date: d, units: r?.units ?? null, revenue: r?.revenue ?? null, sessions: r?.sessions ?? null, conversion: r ? ratio(r.units, r.sessions) : null, buyBox: r?.buy_box_pct ?? null };
    }),
    totals: now,
    change: { units: change(now.units, before.units), revenue: change(now.revenue, before.revenue), sessions: change(now.sessions, before.sessions) },
    profit: productProfit(productId, dates[0], dates.at(-1)!),
    profitSeries: dailyProfit(productId, dates),
    stock: stockFor(p.asin, p.marketplace),
  };
}

// ---- Ads ----

export async function getAdsDetail(productId: number, range: DateRange) {
  await connection();
  const p = productRef(productId);
  if (!p) return null;
  const { dates } = rangeAndBefore(range);
  const daily = db
    .prepare("SELECT date, cost, sales, clicks, impressions, purchases, units, source FROM ads_products WHERE asin = ? AND marketplace = ? AND date BETWEEN ? AND ?")
    .all(p.asin, p.marketplace, dates[0], dates.at(-1)) as { date: string; cost: number; sales: number; clicks: number; impressions: number; purchases: number; units: number; source: string }[];
  const byDate = new Map(daily.map((r) => [r.date, r]));
  const sum = (k: "cost" | "sales" | "clicks" | "impressions" | "purchases" | "units") => daily.reduce((s, r) => s + r[k], 0);
  const revenue = (db.prepare("SELECT COALESCE(SUM(revenue), 0) v FROM sales_traffic WHERE asin = ? AND marketplace = ? AND date BETWEEN ? AND ?").get(p.asin, p.marketplace, dates[0], dates.at(-1)) as { v: number }).v;

  // Amazon's search term report has no ASIN. Each term is tied to a product through the campaign / ad group
  // it came from (ads_campaign_asins, filled from the Advertised product report). Before any campaign is
  // known for the marketplace, every term is shown and labelled as such.
  const tracked = new Set((db.prepare("SELECT keyword FROM keywords WHERE product_id = ?").all(productId) as { keyword: string }[]).map((k) => k.keyword));
  const mapped = Boolean(db.prepare("SELECT 1 FROM ads_campaign_asins WHERE marketplace = ? LIMIT 1").get(p.marketplace));
  const linked = `EXISTS (SELECT 1 FROM ads_campaign_asins c WHERE c.marketplace = t.marketplace AND c.asin = ? AND c.campaign = t.campaign
                    AND (c.ad_group = '' OR t.ad_group IS NULL OR c.ad_group = t.ad_group))`;
  const shared = `EXISTS (SELECT 1 FROM ads_campaign_asins c WHERE c.marketplace = t.marketplace AND c.asin != ? AND c.campaign = t.campaign
                    AND (c.ad_group = '' OR t.ad_group IS NULL OR c.ad_group = t.ad_group))`;
  const terms = (
    db
      .prepare(
        `SELECT search_term, SUM(impressions) impressions, SUM(clicks) clicks, SUM(cost) cost, SUM(purchases) purchases, SUM(sales) sales, AVG(top_share) top_share,
           MAX(${mapped ? shared : "0"}) shared
         FROM ads_search_terms t WHERE marketplace = ? AND date BETWEEN ? AND ? ${mapped ? `AND ${linked}` : ""}
         GROUP BY search_term ORDER BY sales DESC, clicks DESC LIMIT 200`,
      )
      .all(...(mapped ? [p.asin] : []), p.marketplace, dates[0], dates.at(-1), ...(mapped ? [p.asin] : [])) as {
      search_term: string;
      impressions: number;
      clicks: number;
      cost: number;
      purchases: number;
      sales: number;
      top_share: number | null;
      shared: 0 | 1;
    }[]
  ).map((t) => ({ ...t, shared: t.shared === 1, acos: ratio(t.cost, t.sales), tracked: tracked.has(t.search_term) }));

  return {
    currency: marketplaces[p.marketplace].currency,
    hasData: daily.length > 0 || terms.length > 0,
    /** Sample ad numbers (no real ad data yet): shown labelled, never used in profit. */
    demo: daily.length > 0 && daily.every((r) => r.source === "demo"),
    /** "product": search terms from campaigns advertising this ASIN; "marketplace": all (no campaign links yet). */
    termsScope: (mapped ? "product" : "marketplace") as "product" | "marketplace",
    dates,
    series: dates.map((d) => {
      const r = byDate.get(d);
      return { date: d, cost: r?.cost ?? null, sales: r?.sales ?? null, clicks: r?.clicks ?? null, impressions: r?.impressions ?? null, purchases: r?.purchases ?? null };
    }),
    totals: { cost: sum("cost"), sales: sum("sales"), clicks: sum("clicks"), impressions: sum("impressions"), purchases: sum("purchases"), units: sum("units"), revenue },
    acos: ratio(sum("cost"), sum("sales")),
    tacos: ratio(sum("cost"), revenue),
    terms,
  };
}

/** Last-7-day Sponsored Products numbers per keyword, matched on the exact search term. */
export async function getKeywordAds(productId: number) {
  await connection();
  const p = productRef(productId);
  if (!p) return {};
  const rows = db
    .prepare(
      `SELECT k.keyword, SUM(a.clicks) clicks, SUM(a.cost) cost, SUM(a.sales) sales, AVG(a.top_share) top_share
       FROM keywords k JOIN ads_search_terms a ON a.search_term = k.keyword AND a.marketplace = ?
       WHERE k.product_id = ? AND a.date > ? GROUP BY k.keyword`,
    )
    .all(p.marketplace, productId, addDays(today(), -8)) as { keyword: string; clicks: number; cost: number; sales: number; top_share: number | null }[];
  return Object.fromEntries(rows.map((r) => [r.keyword, { ...r, acos: ratio(r.cost, r.sales) }]));
}

export type KeywordAds = Awaited<ReturnType<typeof getKeywordAds>>;

// ---- Competitors ----

export async function getCompetitorDetail(productId: number, range: DateRange) {
  await connection();
  const p = productRef(productId);
  if (!p) return null;
  const { dates } = rangeAndBefore(range);
  const own = db.prepare("SELECT title, image_url FROM products WHERE id = ?").get(productId) as { title: string | null; image_url: string | null };
  const rivals = db.prepare("SELECT id, asin, title, brand, image_url FROM competitors WHERE product_id = ? ORDER BY id").all(productId) as {
    id: number;
    asin: string;
    title: string | null;
    brand: string | null;
    image_url: string | null;
  }[];
  const snaps = db
    .prepare(`SELECT * FROM listing_snapshots WHERE marketplace = ? AND date BETWEEN ? AND ? AND asin IN (${[p.asin, ...rivals.map((r) => r.asin)].map(() => "?").join(",") || "''"})`)
    .all(p.marketplace, addDays(dates[0], -7), dates.at(-1), p.asin, ...rivals.map((r) => r.asin)) as {
    asin: string;
    date: string;
    bsr: number | null;
    bsr_category: string | null;
    buy_box_price: number | null;
    lowest_price: number | null;
    currency: string;
    offer_count: number | null;
    you_have_buy_box: number | null;
  }[];

  // Your own BSR comes from the daily rank check (bsr_snapshots, one row per category), not the listing snapshots.
  // Use the category the rivals are ranked in so the lines compare like for like; otherwise the broadest one.
  const ownRanks = db
    .prepare("SELECT checked_on date, category, rank FROM bsr_snapshots WHERE product_id = ? AND checked_on BETWEEN ? AND ?")
    .all(productId, addDays(dates[0], -7), dates.at(-1)) as { date: string; category: string; rank: number }[];
  const rivalCategories = snaps.filter((s) => s.asin !== p.asin && s.bsr != null && s.bsr_category).map((s) => s.bsr_category!);
  const ownCategory =
    rivalCategories.find((c) => ownRanks.some((r) => r.category === c)) ??
    ownRanks.reduce<{ category: string; rank: number } | null>((top, r) => (!top || r.rank > top.rank ? r : top), null)?.category;
  for (const r of ownRanks.filter((r) => r.category === ownCategory)) {
    const snap = snaps.find((s) => s.asin === p.asin && s.date === r.date);
    if (snap && snap.bsr == null) Object.assign(snap, { bsr: r.rank, bsr_category: r.category });
    else if (!snap)
      snaps.push({ asin: p.asin, date: r.date, bsr: r.rank, bsr_category: r.category, buy_box_price: null, lowest_price: null, currency: "", offer_count: null, you_have_buy_box: null });
  }

  const summarize = (asin: string) => {
    const mine = snaps.filter((s) => s.asin === asin).sort((a, b) => a.date.localeCompare(b.date));
    const latest = mine.at(-1);
    const weekAgo = mine.filter((s) => s.date <= addDays(latest?.date ?? today(), -7)).at(-1);
    return {
      latest,
      priceChange: latest?.buy_box_price != null && weekAgo?.buy_box_price ? change(latest.buy_box_price, weekAgo.buy_box_price) : null,
      bsrSeries: dates.map((d) => mine.find((s) => s.date === d)?.bsr ?? null),
      priceSeries: dates.map((d) => mine.find((s) => s.date === d)?.buy_box_price ?? null),
    };
  };

  return {
    dates,
    own: { asin: p.asin, title: own.title, image_url: own.image_url, ...summarize(p.asin) },
    rivals: rivals.map((r) => ({ ...r, ...summarize(r.asin) })),
  };
}

// ---- Briefing signals ----

export type Signal = { kind: "up" | "down" | "star" | "info"; text: string; priority: number };

/** Plain-language takeaways from sales, ads, stock and competitors for the product briefing. */
export async function commerceSignals(productId: number): Promise<Signal[]> {
  await connection();
  const p = productRef(productId);
  if (!p) return [];
  const signals: Signal[] = [];
  const money = (n: number) => formatMoney(n, marketplaces[p.marketplace].currency);
  const end = addDays(today(), -1);
  const week = (offset: number) =>
    db
      .prepare("SELECT COALESCE(SUM(units), 0) units, COALESCE(SUM(sessions), 0) sessions, COUNT(*) n FROM sales_traffic WHERE asin = ? AND marketplace = ? AND date BETWEEN ? AND ?")
      .get(p.asin, p.marketplace, addDays(end, -6 - offset), addDays(end, -offset)) as { units: number; sessions: number; n: number };
  const thisWeek = week(0);
  const lastWeek = week(7);
  if (thisWeek.n && lastWeek.n && lastWeek.units) {
    const c = (thisWeek.units - lastWeek.units) / lastWeek.units;
    if (Math.abs(c) >= 0.05) signals.push({ kind: c > 0 ? "up" : "down", text: `Units sold ${c > 0 ? "up" : "down"} ${Math.round(Math.abs(c) * 100)}% on last week (${thisWeek.units} vs ${lastWeek.units}).`, priority: 2 });
    const cvrNow = ratio(thisWeek.units, thisWeek.sessions);
    const cvrBefore = ratio(lastWeek.units, lastWeek.sessions);
    if (cvrNow != null && cvrBefore != null && Math.abs(cvrNow - cvrBefore) >= 0.01)
      signals.push({ kind: cvrNow > cvrBefore ? "up" : "down", text: `Conversion ${cvrNow > cvrBefore ? "rose" : "fell"} to ${(cvrNow * 100).toFixed(1)}% (from ${(cvrBefore * 100).toFixed(1)}%).`, priority: 4 });
  }

  const stock = stockFor(p.asin, p.marketplace);
  if (stock?.low) signals.push({ kind: "down", text: `Low stock: about ${stock.daysOfCover} days left (${stock.fulfillable} units).${stock.inbound ? ` ${stock.inbound} inbound.` : ""}`, priority: 0 });

  const own = db.prepare("SELECT you_have_buy_box FROM listing_snapshots WHERE asin = ? AND marketplace = ? AND you_have_buy_box IS NOT NULL ORDER BY date DESC LIMIT 1").get(p.asin, p.marketplace) as
    | { you_have_buy_box: number }
    | undefined;
  if (own && !own.you_have_buy_box) signals.push({ kind: "down", text: "You don't currently hold the Buy Box.", priority: 0 });

  const rivals = db.prepare("SELECT asin, COALESCE(brand, title, asin) name FROM competitors WHERE product_id = ?").all(productId) as { asin: string; name: string }[];
  for (const r of rivals) {
    const prices = db
      .prepare("SELECT date, buy_box_price FROM listing_snapshots WHERE asin = ? AND marketplace = ? AND buy_box_price IS NOT NULL AND date > ? ORDER BY date")
      .all(r.asin, p.marketplace, addDays(today(), -9)) as { date: string; buy_box_price: number }[];
    const first = prices[0]?.buy_box_price;
    const last = prices.at(-1)?.buy_box_price;
    if (first && last && (first - last) / first >= 0.08)
      signals.push({ kind: "down", text: `${r.name.slice(0, 40)} cut its price ${Math.round(((first - last) / first) * 100)}% to ${money(last)}.`, priority: 1 });
  }

  const ads = db
    .prepare("SELECT COALESCE(SUM(cost), 0) cost, COALESCE(SUM(sales), 0) sales FROM ads_products WHERE asin = ? AND marketplace = ? AND date > ?")
    .get(p.asin, p.marketplace, addDays(today(), -8)) as { cost: number; sales: number };
  if (ads.cost > 0) {
    const acos = ratio(ads.cost, ads.sales);
    signals.push({ kind: acos != null && acos <= 0.3 ? "up" : "info", text: `Ads: ${money(ads.cost)} spent this week${acos != null ? ` at ${Math.round(acos * 100)}% ACoS` : " with no ad sales"}.`, priority: 5 });
  }
  return signals.sort((a, b) => a.priority - b.priority);
}

// ---- Research (Top Search Terms) ----

export async function getResearch({ q, onlyMine }: { q: string; onlyMine: boolean }) {
  await connection();
  const latest = db.prepare("SELECT marketplace, MAX(week_start) week FROM search_terms GROUP BY marketplace ORDER BY week DESC LIMIT 1").get() as
    | { marketplace: MarketplaceCode; week: string }
    | undefined;
  if (!latest) return null;
  const prevWeek = addDays(latest.week, -7);
  const mine = (db.prepare("SELECT asin FROM products UNION SELECT asin FROM competitors").all() as { asin: string }[]).map((r) => r.asin);
  const rows = db
    .prepare(
      `SELECT t.*, prev.frequency_rank AS prev_rank FROM search_terms t
       LEFT JOIN search_terms prev ON prev.marketplace = t.marketplace AND prev.week_start = ? AND prev.term = t.term
       WHERE t.marketplace = ? AND t.week_start = ? AND t.term LIKE ? ORDER BY t.frequency_rank LIMIT 300`,
    )
    .all(prevWeek, latest.marketplace, latest.week, `%${q}%`) as {
    term: string;
    frequency_rank: number;
    prev_rank: number | null;
    asin1: string | null;
    click_share1: number | null;
    conversion_share1: number | null;
    asin2: string | null;
    click_share2: number | null;
    conversion_share2: number | null;
    asin3: string | null;
    click_share3: number | null;
    conversion_share3: number | null;
  }[];
  const tracked = new Set((db.prepare("SELECT keyword FROM keywords").all() as { keyword: string }[]).map((k) => k.keyword));
  const own = new Set((db.prepare("SELECT asin FROM products").all() as { asin: string }[]).map((r) => r.asin));
  const result = rows
    .map((r) => ({
      ...r,
      tracked: tracked.has(r.term),
      clicks: [1, 2, 3]
        .map((i) => ({
          asin: r[`asin${i}` as "asin1"],
          click: r[`click_share${i}` as "click_share1"],
          conversion: r[`conversion_share${i}` as "conversion_share1"],
        }))
        .filter((c): c is { asin: string; click: number | null; conversion: number | null } => Boolean(c.asin))
        .map((c) => ({ ...c, yours: own.has(c.asin), watched: mine.includes(c.asin) && !own.has(c.asin) })),
    }))
    .filter((r) => !onlyMine || r.clicks.some((c) => c.yours));
  return { marketplace: latest.marketplace, week: latest.week, rows: result, products: db.prepare("SELECT id, asin, title FROM products").all() as { id: number; asin: string; title: string | null }[] };
}

// ---- Business ----

/** Every date from `from` to `to` (yyyy-mm-dd, inclusive). */
function datesBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out.length ? out : [to];
}

export async function getBusiness(range: { from: string; to: string }) {
  await connection();
  const dates = datesBetween(range.from, range.to);
  const products = db.prepare("SELECT id, asin, marketplace, title, image_url, unit_cost FROM products ORDER BY id").all() as (ProductRef & { title: string | null; image_url: string | null })[];
  // Revenue and units from orders (current to the hour; the Sales & Traffic report lags and can have gaps),
  // by the order's day in the app's time zone. USD orders only, like the other money on this page.
  const localDay = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const orderRows = (
    db
      .prepare("SELECT purchase_date, qty, item_price, promo_discount, currency FROM orders WHERE status != 'Cancelled' AND purchase_date >= ?")
      .all(addDays(dates[0], -1)) as { purchase_date: string; qty: number; item_price: number; promo_discount: number; currency: string }[]
  )
    .map((o) => ({ ...o, day: localDay(o.purchase_date) }))
    .filter((o) => o.day >= dates[0] && o.day <= dates.at(-1)!);
  const byDay = new Map<string, { revenue: number; units: number }>();
  for (const o of orderRows) {
    const d = byDay.get(o.day) ?? { revenue: 0, units: 0 };
    byDay.set(o.day, { revenue: d.revenue + (o.currency === "USD" || !o.currency ? o.item_price - o.promo_discount : 0), units: d.units + o.qty });
  }
  const daily = [...byDay.entries()].map(([date, v]) => ({ date, ...v }));
  // Conversion needs sessions, which only the Sales & Traffic report has: use the days it covers.
  const traffic = db
    .prepare("SELECT COALESCE(SUM(units), 0) units, COALESCE(SUM(sessions), 0) sessions, COUNT(DISTINCT date) days FROM sales_traffic WHERE date BETWEEN ? AND ?")
    .get(dates[0], dates.at(-1)) as { units: number; sessions: number; days: number };
  const totals = {
    units: daily.reduce((n, d) => n + d.units, 0),
    revenue: daily.reduce((n, d) => n + d.revenue, 0),
    sessions: traffic.sessions,
    trafficDays: traffic.days,
  };
  const perProduct = products.map((p) => ({ ...p, profit: productProfit(p.id, dates[0], dates.at(-1)!), stock: stockFor(p.asin, p.marketplace) }));
  const orders = db.prepare("SELECT * FROM orders ORDER BY purchase_date DESC LIMIT 20").all() as {
    order_id: string;
    sku: string;
    asin: string;
    purchase_date: string;
    status: string;
    qty: number;
    item_price: number;
    currency: string;
    product_name: string;
  }[];
  const inventory = db
    .prepare(
      `SELECT i.* FROM inventory_snapshots i
       WHERE i.date = (SELECT MAX(date) FROM inventory_snapshots j WHERE j.marketplace = i.marketplace) ORDER BY i.fulfillable DESC, i.inbound DESC`,
    )
    .all() as { marketplace: MarketplaceCode; sku: string; asin: string; fulfillable: number; inbound: number; reserved: number; unfulfillable: number; date: string }[];
  // SKUs with nothing available, inbound or reserved (e.g. the same SKUs listed in Canada and Mexico) are left out.
  const stocked = inventory.filter((i) => i.fulfillable + i.inbound + i.reserved > 0);
  const inventoryRows = stocked.map((i) => {
    // Sales pace from orders of the last 14 days.
    const pace = (db
      .prepare("SELECT COALESCE(SUM(qty), 0) / 14.0 v FROM orders WHERE asin = ? AND marketplace = ? AND status != 'Cancelled' AND purchase_date >= ?")
      .get(i.asin, i.marketplace, addDays(today(), -14)) as { v: number }).v;
    const daysOfCover = pace > 0 ? Math.floor(i.fulfillable / pace) : null;
    return { ...i, dailyUnits: pace, daysOfCover, low: daysOfCover != null && daysOfCover < getSettings().lowStockDays };
  });
  const profit = perProduct.reduce((s, p) => s + p.profit.profit, 0);
  return {
    dates,
    totals: { ...totals, conversion: ratio(traffic.units, traffic.sessions), profit, currency: "USD" },
    // Orders are complete, so a day without orders is $0, not missing.
    series: dates.map((d) => byDay.get(d)?.revenue ?? 0),
    perProduct,
    orders,
    inventory: inventoryRows,
    emptySkus: inventory.length - stocked.length,
    lowStockDays: getSettings().lowStockDays,
    hasData: daily.length > 0 || orders.length > 0 || inventory.length > 0,
    /** True once anything has arrived from Amazon itself (not sample data). */
    live: Boolean(
      db.prepare(
        "SELECT 1 FROM sales_traffic WHERE source = 'spapi' UNION SELECT 1 FROM orders WHERE source = 'spapi' UNION SELECT 1 FROM inventory_snapshots WHERE source = 'spapi' UNION SELECT 1 FROM fee_events WHERE source = 'spapi' LIMIT 1",
      ).get(),
    ),
    lastSync: (db.prepare("SELECT MAX(finished_at) t FROM runs WHERE kind IN ('amazon', 'daily') AND status IN ('ok', 'partial')").get() as { t: string | null }).t,
    pendingReports: (db.prepare("SELECT COUNT(*) n FROM report_requests WHERE status IN ('queued', 'pending')").get() as { n: number }).n,
  };
}

/** How many tracked products have FBA stock below the low-stock threshold (for the menu badge). */
export function lowStockCount() {
  const products = db.prepare("SELECT asin, marketplace FROM products").all() as { asin: string; marketplace: MarketplaceCode }[];
  return products.filter((p) => stockFor(p.asin, p.marketplace)?.low).length;
}
