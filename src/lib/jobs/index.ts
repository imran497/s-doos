import { findProfile, isAdsConfigured } from "../amazon/ads";
import { isSpApiConfigured, lastFullWeek } from "../amazon/spapi";
import { isDataForSeoConfigured } from "../dataforseo";
import { addDays, db, today } from "../db";
import { marketplaces, type MarketplaceCode } from "../marketplaces";
import { getSettings } from "../settings";
import { getSerpProvider } from "../serp";
import { DEMO_TABLES, fillAdsDemo, fillSellerDemo } from "./demo";
import { accountMarketplaces, activeMarketplaces, backfillFinances, refreshListingDetails, sellerMarketplaces, snapshotInventory, snapshotListings, syncFinances } from "./direct";
import { hasRealAdsData } from "../ads-upload";
import { syncExpenses } from "./expenses";
import { logRun } from "./log";
import { checkProduct, collectPending, refreshSearchVolumes } from "./ranks";
import { enqueueReport, processReports, researchSeeds } from "./reports";

export { accountMarketplaces, checkProduct, collectPending, logRun, refreshSearchVolumes, sellerMarketplaces, syncExpenses };

/** Fills sample data for whichever Amazon APIs aren't connected yet. */
export function refreshDemo() {
  if (!isSpApiConfigured()) fillSellerDemo();
  // No sample ads once real ad data exists (connected API or uploaded reports).
  if (!isAdsConfigured() && !hasRealAdsData()) fillAdsDemo();
}

/** Sample data from Seller Central, Ads and rank sources that are now connected for real. */
const SELLER_DEMO_TABLES = ["listings", "sales_traffic", "orders", "fee_events", "inventory_snapshots", "listing_snapshots", "sqp_weekly", "search_terms", "bsr_snapshots"];

/** Removes sample data for sources that are connected, so demo numbers never mix with real ones. */
export function pruneDemo() {
  db.transaction(() => {
    const clear = (tables: string[]) => tables.forEach((t) => db.prepare(`DELETE FROM ${t} WHERE source = 'demo'`).run());
    if (isSpApiConfigured()) clear(SELLER_DEMO_TABLES);
    if (isAdsConfigured() || hasRealAdsData()) clear(["ads_search_terms", "ads_products", "ads_campaign_asins"]);
    if (!getSerpProvider().isDemo) clear(["rank_checks"]);
  })();
}

export function clearDemo() {
  db.transaction(() => {
    for (const table of DEMO_TABLES) db.prepare(`DELETE FROM ${table} WHERE source = 'demo'`).run();
  })();
}

/** The Amazon Ads profile for a marketplace, looked up once and remembered. */
async function adsProfile(m: MarketplaceCode) {
  const key = `adsProfile:${m}`;
  const cached = (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  if (cached) return cached;
  const profile = await findProfile(m);
  if (!profile) return null;
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(profile.profileId));
  return String(profile.profileId);
}

/** Queues every report that's due. Safe to call repeatedly: requests are unique per kind, scope and period. */
export async function planReports() {
  const errors: string[] = [];
  let queued = 0;
  const now = today();

  // Reports that failed only because Amazon briefly rejected the login get another chance now that
  // the connection works (a login failure says nothing about the report itself).
  if (isSpApiConfigured() || isAdsConfigured()) {
    queued += db
      .prepare(
        "UPDATE report_requests SET status = 'queued', attempts = 0, external_id = NULL, message = 'Retrying after an earlier sign-in problem' WHERE status = 'failed' AND message LIKE '%login failed%'",
      )
      .run().changes;
    // Already waiting for another try: say so instead of showing the old error.
    db.prepare("UPDATE report_requests SET message = 'Retrying after an earlier sign-in problem' WHERE status = 'queued' AND attempts = 0 AND message LIKE '%login failed%'").run();
  }

  const productMarkets = new Set(activeMarketplaces());
  const markets = await accountMarketplaces();
  const firstInRegion = (m: MarketplaceCode) => markets.find((x) => marketplaces[x].region === marketplaces[m].region) === m;
  for (const m of markets) {
    if (isSpApiConfigured()) {
      // Sales & Traffic: one report per day for the last 30 days (Amazon finalises a day after ~2 days).
      const have = new Set((db.prepare("SELECT date FROM sales_traffic_days WHERE marketplace = ?").all(m) as { date: string }[]).map((r) => r.date));
      for (let i = 2; i <= 31; i++) {
        const d = addDays(now, -i);
        if (!have.has(d) && enqueueReport("sales_traffic", m, d, d)) queued++;
      }
      // Orders: the report covers the whole region (e.g. US, CA and MX together), so request it once per
      // region. A 30-day backfill first, then the last 3 days every hour (orders keep changing status, and
      // the dashboard shows "today so far"). The hour in period_end only makes each request unique.
      if (firstInRegion(m)) {
        const hasOrders = db.prepare("SELECT 1 FROM orders WHERE source = 'spapi' LIMIT 1").get();
        const hour = `${now} ${String(new Date().getHours()).padStart(2, "0")}:00`;
        if (enqueueReport("orders", m, hasOrders ? addDays(now, -3) : addDays(now, -30), hour)) queued++;
        // Cost of goods matches sales to shipments, so fetch orders back to the first shipment
        // (up to two years), in 30-day reports. Each window is requested once.
        const firstShipment = (db.prepare("SELECT MIN(order_date) d FROM shipments").get() as { d: string | null }).d;
        const floor = addDays(now, -730);
        for (let start = firstShipment && firstShipment > floor ? firstShipment : floor; firstShipment && start < addDays(now, -30); start = addDays(start, 30)) {
          const end = addDays(start, 29) < addDays(now, -31) ? addDays(start, 29) : addDays(now, -31);
          if (enqueueReport("orders", m, start, end)) queued++;
        }
      }
      // All your listings, once a day: this is how products appear without being added by hand.
      if (enqueueReport("listings", m, now, now)) queued++;
      // Brand Analytics weekly reports. Top Search Terms is only worth fetching once there are keywords
      // or research seed words to filter it by.
      const week = lastFullWeek();
      if (productMarkets.has(m) && researchSeeds().length && enqueueReport("search_terms", m, week.start, week.end)) queued++;
      // Search Query Performance: the last 8 weeks, for products with an active listing (or added by hand).
      // Inactive listings get no searches, so asking Amazon would only return empty reports.
      const sqpProducts = db
        .prepare(
          `SELECT id FROM products p WHERE marketplace = ? AND (
             NOT EXISTS (SELECT 1 FROM listings l WHERE l.marketplace = p.marketplace AND l.asin = p.asin)
             OR EXISTS (SELECT 1 FROM listings l WHERE l.marketplace = p.marketplace AND l.asin = p.asin AND l.status = 'Active'))`,
        )
        .all(m) as { id: number }[];
      for (const p of sqpProducts) {
        for (let w = 0; w < 8; w++) {
          if (enqueueReport("sqp", String(p.id), addDays(week.start, -7 * w), addDays(week.end, -7 * w))) queued++;
        }
      }
      // Weeks fetched before query rank and prices were stored: fetch them once more (at most daily).
      queued += db
        .prepare(
          `UPDATE report_requests SET status = 'queued', attempts = 0, external_id = NULL, message = 'refreshing for more detail'
           WHERE kind = 'sqp' AND status = 'done' AND updated_at < datetime('now', 'localtime', '-1 day')
             AND EXISTS (SELECT 1 FROM sqp_weekly s WHERE s.product_id = CAST(report_requests.scope AS INTEGER)
                         AND s.week_start = report_requests.period_start AND s.query_score IS NULL AND s.source = 'spapi')`,
        )
        .run().changes;
    }

    if (isAdsConfigured()) {
      try {
        const profileId = await adsProfile(m);
        if (!profileId) {
          errors.push(`No Amazon Ads profile found for ${marketplaces[m].name}.`);
        } else {
          const scope = `${m}:${profileId}`;
          const hasAds = db.prepare("SELECT 1 FROM ads_products WHERE marketplace = ? AND source = 'ads' LIMIT 1").get(m);
          // Reports cover at most 31 days: backfill 60 days in two chunks, then re-pull the last 3 days
          // daily because ad attribution keeps settling.
          const ranges = hasAds ? [[addDays(now, -3), addDays(now, -1)]] : [[addDays(now, -60), addDays(now, -31)], [addDays(now, -30), addDays(now, -1)]];
          for (const [start, end] of ranges) {
            if (enqueueReport("ads_search_terms", scope, start, end)) queued++;
            if (enqueueReport("ads_products", scope, start, end)) queued++;
          }
        }
      } catch (error) {
        errors.push(`Amazon Ads: ${(error as Error).message}`);
      }
    }
  }
  return { queued, errors };
}

/** Inventory, finances and listing snapshots, then queued reports. */
export async function syncAmazon({ waitMs = 0 } = {}) {
  const errors: string[] = [];
  pruneDemo();
  let ms: MarketplaceCode[] = [];
  try {
    ms = await accountMarketplaces();
  } catch (error) {
    // Can't even list the account's marketplaces: the connection itself is the problem.
    return { queued: 0, created: 0, stored: 0, pending: 0, marketplaces: [], errors: [`Seller Central: ${(error as Error).message}`] };
  }
  const planned = await planReports();
  errors.push(...planned.errors);

  if (isSpApiConfigured()) {
    // Account charges (subscription, storage, coupons…) for Misc charges. First, because Amazon's finance
    // data also tells us your seller id, which the Buy Box check below needs.
    errors.push(...(await syncExpenses(ms)).errors);
    const withProducts = new Set(activeMarketplaces());
    for (const m of ms) {
      try {
        await snapshotInventory(m);
      } catch (error) {
        errors.push(`Inventory ${m}: ${(error as Error).message}`);
      }
      if (withProducts.has(m)) {
        const listings = await snapshotListings(m).catch((error: Error) => ({ errors: [error.message] }));
        errors.push(...listings.errors);
      }
    }
    // Finances are returned per region, so call once per region.
    const regions = new Map<string, MarketplaceCode[]>();
    for (const m of ms) regions.set(marketplaces[m].region, [...(regions.get(marketplaces[m].region) ?? []), m]);
    for (const region of regions.values()) {
      try {
        await syncFinances(region[0], region);
        await backfillFinances(region[0], region);
      } catch (error) {
        errors.push(`Finances: ${(error as Error).message}`);
      }
    }
  }

  const reports = await processReports({ waitMs });
  errors.push(...reports.errors);
  if (isSpApiConfigured()) errors.push(...(await refreshListingDetails()).errors);
  return { queued: planned.queued, created: reports.created, stored: reports.stored, pending: reports.pending, marketplaces: ms, errors };
}

/** The daily job: ranks for every keyword, search volume, Amazon data, and demo data where not connected. */
export async function runDaily() {
  return logRun("daily", async () => {
    const products = db.prepare("SELECT id FROM products").all() as { id: number }[];
    const errors: string[] = [];
    let checked = 0;
    let pending = 0;
    for (const p of products) {
      // Don't wait for queued DataForSEO searches here; the scheduler collects them.
      const r = await checkProduct(p.id, undefined, 0);
      checked += r.checked;
      pending += r.pending;
      errors.push(...r.errors);
    }
    errors.push(...(await refreshSearchVolumes()).errors);
    if (isSpApiConfigured() || isAdsConfigured()) errors.push(...(await syncAmazon()).errors);
    pruneDemo();
    refreshDemo();
    return { checked, pending, errors };
  });
}

/** Runs every few minutes while the app is up: collects finished work, then the daily job when due. */
export async function schedulerTick() {
  if (isDataForSeoConfigured()) {
    const r = await collectPending();
    if (r.errors.length) console.error("[SellerDoos] collecting searches:", r.errors.slice(0, 3).join("; "));
  }
  if (isSpApiConfigured() || isAdsConfigured()) {
    // Queue anything newly due (e.g. this hour's orders refresh), then create/collect reports.
    await planReports().catch((error: Error) => console.error("[SellerDoos] planning reports:", error.message));
    const r = await processReports();
    if (r.errors.length) console.error("[SellerDoos] reports:", r.errors.slice(0, 3).join("; "));
    if (isSpApiConfigured()) {
      const details = await refreshListingDetails();
      if (details.errors.length) console.error("[SellerDoos] listing details:", details.errors.slice(0, 3).join("; "));
    }
  }
  if (isDailyRunDue()) await runDaily();
}

/** True once the scheduled hour has passed and today's daily run hasn't happened yet. */
export function isDailyRunDue(now = new Date()) {
  const { scheduleHour } = getSettings();
  if (now.getHours() < scheduleHour) return false;
  const last = db.prepare("SELECT started_at FROM runs WHERE kind = 'daily' ORDER BY id DESC LIMIT 1").get() as { started_at: string } | undefined;
  return !last || last.started_at.slice(0, 10) < today();
}
