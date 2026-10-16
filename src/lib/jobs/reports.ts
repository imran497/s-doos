import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { createAdsReport, downloadAdsReport, getAdsReport, type AdsProductRow, type AdsSearchTermRow } from "../amazon/ads";
import { ApiError } from "../amazon/http";
import { createReport, getReportStatus, parseListingsReport, parseOrdersFlatFile, parseSalesTraffic, parseSqp, reportStream, reportText, type ListingRow } from "../amazon/spapi";
import { db } from "../db";
import { isMarketplace, marketplaces, type MarketplaceCode } from "../marketplaces";

// The report queue. Amazon builds reports asynchronously, so each one is:
//   queued (row exists) → created at Amazon (external_id set, status pending) → polled → stored (done).
// Creation is paced per report type to stay inside Amazon's rate limits; the scheduler calls
// processReports() every few minutes, and "Sync now" calls it with a short wait.

export type ReportRequest = {
  id: number;
  kind: string;
  scope: string;
  period_start: string;
  period_end: string;
  external_id: string | null;
  status: string;
  attempts: number;
};

type CheckResult = { state: "pending" } | { state: "done"; stored: number } | { state: "failed"; message: string; retry: boolean };

type Handler = {
  /** Max reports of this kind to create per scheduler tick. */
  perTick: number;
  create(req: ReportRequest): Promise<string>;
  check(req: ReportRequest): Promise<CheckResult>;
};

const marketplaceOf = (scope: string): MarketplaceCode => {
  const code = scope.split(":")[0];
  if (!isMarketplace(code)) throw new Error(`Unknown marketplace in report scope "${scope}"`);
  return code;
};

/** Shared SP-API polling: returns the document id once DONE. CANCELLED means Amazon had no data. */
async function spReport(req: ReportRequest, store: (documentId: string, m: MarketplaceCode) => Promise<number>): Promise<CheckResult> {
  const m = req.kind === "sqp" ? productOf(req).marketplace : marketplaceOf(req.scope);
  const r = await getReportStatus(req.external_id!, m);
  if (r.status === "DONE" && r.documentId) return { state: "done", stored: await store(r.documentId, m) };
  if (r.status === "CANCELLED") return { state: "done", stored: 0 };
  if (r.status === "FATAL") return { state: "failed", message: "Amazon couldn't build this report (often: data not ready yet)", retry: true };
  return { state: "pending" };
}

const productOf = (req: ReportRequest) => {
  const p = db.prepare("SELECT id, asin, marketplace FROM products WHERE id = ?").get(Number(req.scope)) as
    | { id: number; asin: string; marketplace: MarketplaceCode }
    | undefined;
  if (!p) throw new Error("Product no longer exists");
  return p;
};

/** A row from the orders report that isn't a customer purchase: no price and no currency. */
export const isInternalOrder = (row: { itemPrice: number; currency: string }) => !row.currency && !row.itemPrice;

// ---- Report types ----

const handlers: Record<string, Handler> = {
  // Search Query Performance, weekly, per ASIN.
  sqp: {
    perTick: 5,
    create: (req) => {
      const p = productOf(req);
      return createReport({
        reportType: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
        marketplace: p.marketplace,
        start: req.period_start,
        end: req.period_end,
        options: { reportPeriod: "WEEK", asin: p.asin },
      });
    },
    check: (req) =>
      spReport(req, async (doc, m) => {
        const rows = parseSqp(await reportText(doc, m));
        const save = db.prepare(`
          INSERT INTO sqp_weekly (product_id, week_start, week_end, search_query, query_volume, impressions, asin_impressions,
            clicks, asin_clicks, cart_adds, asin_cart_adds, purchases, asin_purchases, query_score, asin_click_price, market_click_price,
            asin_purchase_price, market_purchase_price, source)
          VALUES (@productId, @weekStart, @weekEnd, @searchQuery, @queryVolume, @impressions, @asinImpressions,
            @clicks, @asinClicks, @cartAdds, @asinCartAdds, @purchases, @asinPurchases, @queryScore, @asinClickPrice, @marketClickPrice,
            @asinPurchasePrice, @marketPurchasePrice, 'spapi')
          ON CONFLICT(product_id, week_start, search_query) DO UPDATE SET
            query_volume = excluded.query_volume, impressions = excluded.impressions, asin_impressions = excluded.asin_impressions,
            clicks = excluded.clicks, asin_clicks = excluded.asin_clicks, cart_adds = excluded.cart_adds,
            asin_cart_adds = excluded.asin_cart_adds, purchases = excluded.purchases, asin_purchases = excluded.asin_purchases,
            query_score = excluded.query_score, asin_click_price = excluded.asin_click_price, market_click_price = excluded.market_click_price,
            asin_purchase_price = excluded.asin_purchase_price, market_purchase_price = excluded.market_purchase_price, source = 'spapi'`);
        db.transaction(() => {
          for (const row of rows) save.run({ productId: Number(req.scope), weekStart: req.period_start, weekEnd: req.period_end, ...row });
        })();
        return rows.length;
      }),
  },

  // Sales & Traffic, one day per report (the per-ASIN section is aggregated over the whole range).
  // Amazon allows about 3 of these per 5 minutes.
  sales_traffic: {
    perTick: 3,
    create: (req) =>
      createReport({
        reportType: "GET_SALES_AND_TRAFFIC_REPORT",
        marketplace: marketplaceOf(req.scope),
        start: req.period_start,
        end: req.period_end,
        options: { dateGranularity: "DAY", asinGranularity: "CHILD" },
      }),
    check: (req) =>
      spReport(req, async (doc, m) => {
        const rows = parseSalesTraffic(await reportText(doc, m));
        const save = db.prepare(`
          INSERT INTO sales_traffic (marketplace, asin, date, units, revenue, currency, order_items, sessions, page_views,
            buy_box_pct, unit_session_pct, source)
          VALUES (@m, @asin, @date, @units, @revenue, @currency, @orderItems, @sessions, @pageViews, @buyBoxPct, @unitSessionPct, 'spapi')
          ON CONFLICT(marketplace, asin, date) DO UPDATE SET units = excluded.units, revenue = excluded.revenue,
            currency = excluded.currency, order_items = excluded.order_items, sessions = excluded.sessions,
            page_views = excluded.page_views, buy_box_pct = excluded.buy_box_pct, unit_session_pct = excluded.unit_session_pct,
            source = 'spapi'`);
        db.transaction(() => {
          for (const row of rows) save.run({ m, date: req.period_start, ...row });
          db.prepare("INSERT OR IGNORE INTO sales_traffic_days (marketplace, date) VALUES (?, ?)").run(m, req.period_start);
        })();
        return rows.length;
      }),
  },

  // All orders updated in the period (tab-separated flat file).
  orders: {
    perTick: 2,
    create: (req) =>
      createReport({
        reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL",
        marketplace: marketplaceOf(req.scope),
        start: req.period_start,
        end: req.period_end,
      }),
    check: (req) =>
      spReport(req, async (doc, m) => {
        const rows = parseOrdersFlatFile(await reportText(doc, m));
        // The orders report can include every marketplace in the region, whatever was asked for:
        // file each order under the marketplace it was actually placed in ("Amazon.com" → US).
        const byDomain = new Map<string, MarketplaceCode>(Object.entries(marketplaces).map(([code, info]) => [info.domain, code as MarketplaceCode]));
        const orderMarketplace = (channel: string) => byDomain.get(channel.toLowerCase().replace(/^www\./, "")) ?? m;
        const save = db.prepare(`
          INSERT INTO orders (order_id, sku, marketplace, asin, purchase_date, status, channel, product_name, qty, item_price, currency,
            promo_discount, promo_ids, source)
          VALUES (@orderId, @sku, @m, @asin, @purchaseDate, @status, @channel, @productName, @qty, @itemPrice, @currency,
            @promoDiscount, @promoIds, 'spapi')
          ON CONFLICT(order_id, sku) DO UPDATE SET status = excluded.status, qty = excluded.qty, item_price = excluded.item_price,
            currency = excluded.currency, channel = excluded.channel, marketplace = excluded.marketplace,
            promo_discount = excluded.promo_discount, promo_ids = excluded.promo_ids, source = 'spapi'`);
        const map = db.prepare("INSERT INTO sku_map (sku, asin) VALUES (?, ?) ON CONFLICT(sku) DO UPDATE SET asin = excluded.asin");
        db.transaction(() => {
          for (const row of rows) {
            if (!row.orderId || !row.sku) continue;
            // Amazon's internal, non-retail orders (ids like S01-…) carry no price or currency and aren't
            // sales, so they'd inflate units and cost of goods.
            if (isInternalOrder(row)) continue;
            save.run({ ...row, m: orderMarketplace(row.salesChannel) });
            if (row.asin) map.run(row.sku, row.asin);
          }
        })();
        return rows.length;
      }),
  },

  // Every listing you have (active and inactive), refreshed daily. Also how products get added.
  listings: {
    // One small report per marketplace a day: request them all at once.
    perTick: 12,
    create: (req) => createReport({ reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplace: marketplaceOf(req.scope) }),
    check: (req) => spReport(req, async (doc, m) => storeListings(m, parseListingsReport(await reportText(doc, m)))),
  },

  // Top Search Terms, weekly. ~12 million rows: streamed and filtered, never loaded whole.
  search_terms: {
    perTick: 1,
    create: (req) =>
      createReport({
        reportType: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT",
        marketplace: marketplaceOf(req.scope),
        start: req.period_start,
        end: req.period_end,
        options: { reportPeriod: "WEEK" },
      }),
    check: (req) => spReport(req, async (doc, m) => importSearchTerms(await reportStream(doc, m), m, req.period_start)),
  },

  // Amazon Ads: Sponsored Products search terms and advertised products (scope "US:<profileId>").
  ads_search_terms: adsHandler("searchTerms"),
  ads_products: adsHandler("products"),
};

function adsHandler(kind: "searchTerms" | "products"): Handler {
  return {
    perTick: 4,
    create: (req) => createAdsReport(marketplaceOf(req.scope), req.scope.split(":")[1], kind, req.period_start, req.period_end),
    async check(req) {
      const m = marketplaceOf(req.scope);
      const r = await getAdsReport(m, req.scope.split(":")[1], req.external_id!);
      if (r.status === "FAILED" || r.status === "FAILURE") return { state: "failed", message: r.failureReason ?? "Report failed", retry: true };
      if (r.status !== "COMPLETED" || !r.url) return { state: "pending" };
      return { state: "done", stored: kind === "searchTerms" ? storeAdsSearchTerms(m, req, await downloadAdsReport(r.url, "searchTerms")) : storeAdsProducts(m, req, await downloadAdsReport(r.url, "products")) };
    },
  };
}

function storeAdsSearchTerms(m: MarketplaceCode, req: ReportRequest, rows: AdsSearchTermRow[]) {
  // The report fully covers its date range, so replace those days.
  db.transaction(() => {
    db.prepare("DELETE FROM ads_search_terms WHERE marketplace = ? AND date BETWEEN ? AND ? AND source = 'ads'").run(m, req.period_start, req.period_end);
    const save = db.prepare(`
      INSERT INTO ads_search_terms (marketplace, date, search_term, keyword, match_type, campaign, impressions, clicks, cost,
        purchases, sales, units, top_share, source)
      VALUES (@m, @date, @searchTerm, @keyword, @matchType, @campaign, @impressions, @clicks, @cost, @purchases, @sales, @units, @topShare, 'ads')`);
    for (const r of rows) save.run({ m, ...r });
  })();
  return rows.length;
}

function storeAdsProducts(m: MarketplaceCode, req: ReportRequest, rows: AdsProductRow[]) {
  db.transaction(() => {
    db.prepare("DELETE FROM ads_products WHERE marketplace = ? AND date BETWEEN ? AND ? AND source = 'ads'").run(m, req.period_start, req.period_end);
    // Several SKUs can advertise one ASIN: sum them.
    const save = db.prepare(`
      INSERT INTO ads_products (marketplace, date, asin, impressions, clicks, cost, purchases, sales, units, source)
      VALUES (@m, @date, @asin, @impressions, @clicks, @cost, @purchases, @sales, @units, 'ads')
      ON CONFLICT(marketplace, date, asin) DO UPDATE SET impressions = impressions + excluded.impressions,
        clicks = clicks + excluded.clicks, cost = cost + excluded.cost, purchases = purchases + excluded.purchases,
        sales = sales + excluded.sales, units = units + excluded.units, source = 'ads'`);
    const map = db.prepare("INSERT INTO sku_map (sku, asin) VALUES (?, ?) ON CONFLICT(sku) DO UPDATE SET asin = excluded.asin");
    for (const r of rows) {
      save.run({ m, ...r });
      if (r.sku) map.run(r.sku, r.asin);
    }
  })();
  return rows.length;
}

/**
 * Replaces the marketplace's listings with the report's (keeping the prices and fees fetched earlier),
 * and makes sure every listed ASIN is a product.
 */
export function storeListings(m: MarketplaceCode, rows: ListingRow[]) {
  const currency = marketplaces[m].currency;
  db.transaction(() => {
    const save = db.prepare(`
      INSERT INTO listings (marketplace, sku, asin, title, status, fulfillment, price, quantity, open_date, currency, updated_at, source)
      VALUES (@m, @sku, @asin, @title, @status, @fulfillment, @price, @quantity, @openDate, @currency, datetime('now', 'localtime'), 'spapi')
      ON CONFLICT(marketplace, sku) DO UPDATE SET asin = excluded.asin, title = excluded.title, status = excluded.status,
        fulfillment = excluded.fulfillment, price = excluded.price, quantity = excluded.quantity, open_date = excluded.open_date,
        currency = excluded.currency, updated_at = excluded.updated_at, source = 'spapi'`);
    const map = db.prepare("INSERT INTO sku_map (sku, asin) VALUES (?, ?) ON CONFLICT(sku) DO UPDATE SET asin = excluded.asin");
    const product = db.prepare("INSERT INTO products (asin, marketplace, title) VALUES (?, ?, NULLIF(?, '')) ON CONFLICT(asin, marketplace) DO NOTHING");
    for (const r of rows) {
      save.run({ m, currency, ...r });
      map.run(r.sku, r.asin);
      product.run(r.asin, m, r.title);
    }
    // SKUs no longer in the report were deleted in Seller Central. (An empty report is more likely a
    // hiccup than a seller with no listings, so keep what's there.)
    if (!rows.length) return;
    const skus = new Set(rows.map((r) => r.sku));
    const gone = db.prepare("DELETE FROM listings WHERE marketplace = ? AND sku = ?");
    for (const { sku } of db.prepare("SELECT sku FROM listings WHERE marketplace = ? AND source = 'spapi'").all(m) as { sku: string }[]) {
      if (!skus.has(sku)) gone.run(m, sku);
    }
  })();
  return rows.length;
}

// ---- Top Search Terms import ----

/** Words from tracked keywords (plus Settings) that make a search term worth keeping. */
export function researchSeeds() {
  const stop = new Set(["for", "and", "the", "with", "set", "kids", "year", "old", "of", "to", "a", "in", "toy", "toys", "pack", "pcs", "piece"]);
  const fromKeywords = (db.prepare("SELECT keyword FROM keywords").all() as { keyword: string }[]).flatMap((k) => k.keyword.split(/\s+/));
  const extra = (db.prepare("SELECT value FROM settings WHERE key = 'researchSeeds'").get() as { value: string } | undefined)?.value ?? "";
  return [...new Set([...fromKeywords, ...extra.split(/[,\n]/)].map((w) => w.trim().toLowerCase()).filter((w) => w.length > 2 && !stop.has(w)))];
}

type TermRow = { departmentName?: string; searchTerm?: string; searchFrequencyRank?: number; clickedAsin?: string; clickShareRank?: number; clickShare?: number; conversionShare?: number };

/**
 * Streams `dataByDepartmentAndSearchTerm` (one row per term × clicked ASIN, rank 1–3) and keeps terms that
 * contain a seed word or where one of your/competitors' ASINs is a top click.
 */
export async function importSearchTerms(source: NodeJS.ReadableStream, m: MarketplaceCode, weekStart: string) {
  const seeds = researchSeeds();
  const watched = new Set(
    (db.prepare("SELECT asin FROM products UNION SELECT asin FROM competitors").all() as { asin: string }[]).map((r) => r.asin),
  );
  const relevant = (term: string) => seeds.some((s) => term.includes(s));

  const terms = new Map<string, { rank: number; department: string; clicks: { asin: string; click: number | null; conv: number | null }[]; keep: boolean }>();
  const rows = source.pipe(pick.withParserAsStream({ filter: "dataByDepartmentAndSearchTerm" })).pipe(streamArray.asStream());
  for await (const { value } of rows as AsyncIterable<{ value: TermRow }>) {
    const term = value.searchTerm?.toLowerCase();
    if (!term || !value.clickedAsin) continue;
    let entry = terms.get(term);
    const keep = relevant(term) || watched.has(value.clickedAsin);
    if (!entry) {
      if (!keep) continue;
      entry = { rank: value.searchFrequencyRank ?? 0, department: value.departmentName ?? "", clicks: [], keep };
      terms.set(term, entry);
    }
    entry.clicks[(value.clickShareRank ?? entry.clicks.length + 1) - 1] = { asin: value.clickedAsin, click: value.clickShare ?? null, conv: value.conversionShare ?? null };
  }

  const save = db.prepare(`
    INSERT INTO search_terms (marketplace, week_start, term, frequency_rank, department, asin1, click_share1, conversion_share1,
      asin2, click_share2, conversion_share2, asin3, click_share3, conversion_share3, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'spapi')
    ON CONFLICT(marketplace, week_start, term) DO UPDATE SET frequency_rank = excluded.frequency_rank,
      asin1 = excluded.asin1, click_share1 = excluded.click_share1, conversion_share1 = excluded.conversion_share1,
      asin2 = excluded.asin2, click_share2 = excluded.click_share2, conversion_share2 = excluded.conversion_share2,
      asin3 = excluded.asin3, click_share3 = excluded.click_share3, conversion_share3 = excluded.conversion_share3, source = 'spapi'`);
  db.transaction(() => {
    for (const [term, e] of terms) {
      const c = (i: number) => [e.clicks[i]?.asin ?? null, e.clicks[i]?.click ?? null, e.clicks[i]?.conv ?? null];
      save.run(m, weekStart, term, e.rank, e.department, ...c(0), ...c(1), ...c(2));
    }
  })();
  return terms.size;
}

// ---- Queue ----

/** Adds a report to the queue unless the same one is already queued or done. */
export function enqueueReport(kind: string, scope: string, start: string, end: string) {
  return db
    .prepare("INSERT OR IGNORE INTO report_requests (kind, scope, period_start, period_end) VALUES (?, ?, ?, ?)")
    .run(kind, scope, start, end).changes > 0;
}

const update = db.prepare(
  "UPDATE report_requests SET status = @status, external_id = COALESCE(@external_id, external_id), message = @message, attempts = @attempts, updated_at = datetime('now', 'localtime') WHERE id = @id",
);

/**
 * Creates queued reports (within each type's per-tick limit), then polls the ones Amazon is building,
 * storing finished results. With `waitMs`, keeps polling until nothing is pending or time runs out.
 */
export async function processReports({ waitMs = 0, kinds }: { waitMs?: number; kinds?: string[] } = {}) {
  const deadline = Date.now() + waitMs;
  const errors: string[] = [];
  let created = 0;
  let stored = 0;
  const inScope = (r: ReportRequest) => handlers[r.kind] && (!kinds || kinds.includes(r.kind));

  // 1. Create, newest periods first so recent data arrives before backfill.
  // A failed request is retried no sooner than 6 hours later (e.g. Amazon hadn't finished that week's data).
  const queued = (
    db
      .prepare(
        `SELECT * FROM report_requests WHERE status = 'queued' AND (attempts = 0 OR updated_at < datetime('now', 'localtime', '-6 hours')
           OR message LIKE '%login failed%') ORDER BY period_start DESC`,
      )
      .all() as ReportRequest[]
  ).filter(inScope);
  const createdPerKind: Record<string, number> = {};
  const throttled = new Set<string>();
  for (const req of queued) {
    const h = handlers[req.kind];
    if (throttled.has(req.kind) || (createdPerKind[req.kind] ?? 0) >= h.perTick) continue;
    try {
      const externalId = await h.create(req);
      update.run({ id: req.id, status: "pending", external_id: externalId, message: null, attempts: req.attempts });
      createdPerKind[req.kind] = (createdPerKind[req.kind] ?? 0) + 1;
      created++;
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        throttled.add(req.kind); // try again next tick
        continue;
      }
      if (/login failed/i.test((error as Error).message)) {
        // A connection problem, not a problem with this report: stop for now, retry next tick, don't count it.
        update.run({ id: req.id, status: "queued", external_id: null, message: (error as Error).message, attempts: req.attempts });
        errors.push((error as Error).message);
        break;
      }
      const attempts = req.attempts + 1;
      update.run({ id: req.id, status: attempts >= 3 ? "failed" : "queued", external_id: null, message: (error as Error).message, attempts });
      errors.push(`${req.kind} ${req.period_start}: ${(error as Error).message}`);
    }
  }

  // 2. Poll until done or out of time.
  for (;;) {
    const pending = (db.prepare("SELECT * FROM report_requests WHERE status = 'pending'").all() as ReportRequest[]).filter(inScope);
    for (const req of pending) {
      try {
        const result = await handlers[req.kind].check(req);
        if (result.state === "done") {
          update.run({ id: req.id, status: "done", external_id: null, message: `${result.stored} rows`, attempts: req.attempts });
          stored += result.stored;
        } else if (result.state === "failed") {
          const attempts = req.attempts + 1;
          // Requeue so it's requested again on a later tick (e.g. data that wasn't ready yet), up to 3 times.
          update.run({ id: req.id, status: result.retry && attempts < 3 ? "queued" : "failed", external_id: null, message: result.message, attempts });
          if (!result.retry || attempts >= 3) errors.push(`${req.kind} ${req.period_start}: ${result.message}`);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) continue;
        errors.push(`${req.kind} ${req.period_start}: ${(error as Error).message}`);
      }
    }
    const stillPending = (db.prepare("SELECT kind, scope FROM report_requests WHERE status = 'pending'").all() as ReportRequest[]).filter(inScope).length;
    const pollMs = Number(process.env.REPORT_POLL_MS) || 15_000; // tests poll faster
    if (!stillPending || Date.now() + pollMs > deadline) return { created, stored, pending: stillPending, errors };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
