import "server-only";
import { connection } from "next/server";
import { db } from "./db";

// Search Query Performance for one product: Amazon's weekly Brand Analytics funnel per search query
// (searches → impressions → clicks → cart adds → purchases), yours vs. all products. A period of several
// weeks adds the counts up; shares are computed from the totals.

export type SqpQueryRow = {
  query: string;
  /** Amazon's rank by search volume (1 = most searched); the best rank within the period. */
  rank: number | null;
  searches: number;
  impressions: number;
  asinImpressions: number;
  clicks: number;
  asinClicks: number;
  cartAdds: number;
  asinCartAdds: number;
  purchases: number;
  asinPurchases: number;
  asinClickPrice: number | null;
  marketClickPrice: number | null;
  tracked: boolean;
};

const fmtWeek = (start: string, end: string) => {
  const d = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${d(start)} – ${d(end)}`;
};

/**
 * Search query performance for the weeks overlapping [from, to] (dates as yyyy-mm-dd). Amazon reports
 * Search Query Performance per Sunday–Saturday week only, so a date range covers whole weeks.
 */
export async function getSqpPerformance(productId: number, range: { from: string; to: string }) {
  await connection();
  const all = db
    .prepare("SELECT DISTINCT week_start, week_end FROM sqp_weekly WHERE product_id = ? ORDER BY week_start DESC")
    .all(productId) as { week_start: string; week_end: string }[];
  const inRange = all.filter((w) => w.week_start <= range.to && w.week_end >= range.from);
  const latest = all[0] ? { start: all[0].week_start, end: all[0].week_end, label: fmtWeek(all[0].week_start, all[0].week_end) } : null;
  if (!inRange.length) return { hasData: all.length > 0, latest, covered: null, rows: [] as SqpQueryRow[], totals: null, sessions: null };

  const covered = {
    from: inRange.at(-1)!.week_start,
    to: inRange[0].week_end,
    weeks: inRange.length,
    label: inRange.length === 1 ? `week of ${fmtWeek(inRange[0].week_start, inRange[0].week_end)}` : `${inRange.length} weeks, ${fmtWeek(inRange.at(-1)!.week_start, inRange[0].week_end)}`,
  };
  const period = { weeks: inRange.map((w) => w.week_start) };
  const marks = period.weeks.map(() => "?").join(",");
  const rows = (
    db
      .prepare(
        `SELECT search_query query, MIN(query_score) rank, SUM(query_volume) searches,
           SUM(impressions) impressions, SUM(asin_impressions) asinImpressions, SUM(clicks) clicks, SUM(asin_clicks) asinClicks,
           SUM(cart_adds) cartAdds, SUM(asin_cart_adds) asinCartAdds, SUM(purchases) purchases, SUM(asin_purchases) asinPurchases,
           AVG(asin_click_price) asinClickPrice, AVG(market_click_price) marketClickPrice,
           EXISTS (SELECT 1 FROM keywords k WHERE k.product_id = ? AND k.keyword = search_query) tracked
         FROM sqp_weekly WHERE product_id = ? AND week_start IN (${marks})
         GROUP BY search_query ORDER BY searches DESC`,
      )
      .all(productId, productId, ...period.weeks) as (Omit<SqpQueryRow, "tracked"> & { tracked: 0 | 1 })[]
  ).map((r) => ({
    ...r,
    searches: r.searches ?? 0,
    impressions: r.impressions ?? 0,
    asinImpressions: r.asinImpressions ?? 0,
    clicks: r.clicks ?? 0,
    asinClicks: r.asinClicks ?? 0,
    cartAdds: r.cartAdds ?? 0,
    asinCartAdds: r.asinCartAdds ?? 0,
    purchases: r.purchases ?? 0,
    asinPurchases: r.asinPurchases ?? 0,
    tracked: r.tracked === 1,
  }));

  const sum = (k: keyof Pick<SqpQueryRow, "searches" | "impressions" | "asinImpressions" | "clicks" | "asinClicks" | "cartAdds" | "asinCartAdds" | "purchases" | "asinPurchases">) =>
    rows.reduce((n, r) => n + r[k], 0);
  const totals = {
    queries: rows.length,
    searches: sum("searches"),
    impressions: sum("impressions"),
    asinImpressions: sum("asinImpressions"),
    clicks: sum("clicks"),
    asinClicks: sum("asinClicks"),
    cartAdds: sum("cartAdds"),
    asinCartAdds: sum("asinCartAdds"),
    purchases: sum("purchases"),
    asinPurchases: sum("asinPurchases"),
  };

  // Sessions on the product page in the same weeks (Sales & Traffic report; not broken down by search query).
  const product = db.prepare("SELECT asin, marketplace FROM products WHERE id = ?").get(productId) as { asin: string; marketplace: string } | undefined;
  const traffic = product
    ? (db
        .prepare("SELECT SUM(sessions) sessions, SUM(page_views) pageViews, COUNT(*) days FROM sales_traffic WHERE asin = ? AND marketplace = ? AND date BETWEEN ? AND ?")
        .get(product.asin, product.marketplace, covered.from, covered.to) as { sessions: number | null; pageViews: number | null; days: number })
    : null;

  return { hasData: true, latest, covered, rows, totals, sessions: traffic?.days ? traffic : null };
}

export type SqpPerformance = Awaited<ReturnType<typeof getSqpPerformance>>;
