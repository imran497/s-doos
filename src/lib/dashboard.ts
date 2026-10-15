import "server-only";
import { connection } from "next/server";
import { db } from "./db";
import { marketplaces, type MarketplaceCode } from "./marketplaces";
import { ymd, type Period } from "./periods";

// Dashboard numbers for one marketplace and period, plus the previous period for comparison.
// Sales come from orders (refreshed hourly from Amazon, so "today so far" is close to live); cancelled
// orders are left out. Ads come from Sponsored Products reports, which Amazon publishes per day.

export type SalesTotals = { units: number; amount: number; orders: number; avgOrder: number | null };
export type AdsTotals = { spend: number; sales: number; purchases: number; clicks: number; impressions: number; cpc: number | null; acos: number | null };

function salesTotals(rows: { order_id: string; qty: number; item_price: number }[]): SalesTotals {
  const orders = new Set(rows.map((r) => r.order_id)).size;
  const amount = rows.reduce((s, r) => s + r.item_price, 0);
  return { units: rows.reduce((s, r) => s + r.qty, 0), amount, orders, avgOrder: orders ? amount / orders : null };
}

function adsTotals(rows: { cost: number; sales: number; purchases: number; clicks: number; impressions: number }[]): AdsTotals {
  const t = rows.reduce(
    (a, r) => ({ spend: a.spend + r.cost, sales: a.sales + r.sales, purchases: a.purchases + r.purchases, clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }),
    { spend: 0, sales: 0, purchases: 0, clicks: 0, impressions: 0 },
  );
  return { ...t, cpc: t.clicks ? t.spend / t.clicks : null, acos: t.sales ? t.spend / t.sales : null };
}

/** Marketplaces that have any orders or ads data, most orders first (for the marketplace picker). */
export async function dashboardMarketplaces() {
  await connection();
  const rows = db
    .prepare(
      `SELECT marketplace, SUM(n) n FROM (
         SELECT marketplace, COUNT(*) n FROM orders GROUP BY marketplace
         UNION ALL SELECT marketplace, COUNT(*) n FROM ads_products GROUP BY marketplace
       ) GROUP BY marketplace ORDER BY n DESC`,
    )
    .all() as { marketplace: MarketplaceCode; n: number }[];
  return rows.map((r) => r.marketplace).filter((m) => m in marketplaces);
}

export async function getDashboard(period: Period, marketplace: MarketplaceCode) {
  await connection();

  // Orders: purchase dates are ISO timestamps with offsets, so filter precisely in code.
  const orderRows = (
    db
      .prepare("SELECT order_id, qty, item_price, purchase_date, status, source FROM orders WHERE marketplace = ? AND status != 'Cancelled' AND purchase_date >= ?")
      .all(marketplace, ymd(new Date(period.prevStart.getTime() - 86_400_000))) as {
      order_id: string;
      qty: number;
      item_price: number;
      purchase_date: string;
      status: string;
      source: string;
    }[]
  ).map((r) => ({ ...r, at: Date.parse(r.purchase_date) }));
  const inRange = (from: Date, to: Date) => orderRows.filter((r) => r.at >= from.getTime() && r.at < to.getTime());

  // Ads: one row per marketplace day. A day counts if it falls inside the range.
  const adRows = (
    db
      .prepare("SELECT date, cost, sales, purchases, clicks, impressions, source FROM ads_products WHERE marketplace = ? AND date >= ? AND date <= ?")
      .all(marketplace, ymd(period.prevStart), ymd(period.end)) as { date: string; cost: number; sales: number; purchases: number; clicks: number; impressions: number; source: string }[]
  ).map((r) => {
    const [y, mo, d] = r.date.split("-").map(Number);
    return { ...r, at: new Date(y, mo - 1, d).getTime() };
  });
  // A partial day (today so far) includes that day's ad row if Amazon has published one.
  const adsIn = (from: Date, to: Date) => adRows.filter((r) => r.at >= new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime() && r.at < to.getTime());

  // Compare only when there's history covering the whole previous period; otherwise a period with no
  // earlier data would show as a huge jump.
  const DAY = 86_400_000;
  const firstOrder = orderRows.reduce((min, r) => Math.min(min, r.at), Infinity);
  const firstAdDay = adRows.reduce((min, r) => Math.min(min, r.at), Infinity);
  const ordersCoverPrevious = firstOrder <= period.prevStart.getTime() + DAY;
  const adsCoverPrevious = firstAdDay <= period.prevStart.getTime() + DAY;

  // Moves a point in the current period to the same point in the previous one.
  const offset = period.start.getTime() - period.prevStart.getTime();
  const shift = (d: Date) => new Date(d.getTime() - offset);

  const lastOrdersSync = (
    db.prepare("SELECT MAX(updated_at) t FROM report_requests WHERE kind = 'orders' AND status = 'done'").get() as { t: string | null }
  ).t;

  return {
    marketplace,
    currency: marketplaces[marketplace].currency,
    sales: {
      current: salesTotals(inRange(period.start, period.end)),
      previous: ordersCoverPrevious ? salesTotals(inRange(period.prevStart, period.prevEnd)) : null,
      // Each point carries the matching point of the previous period (same offset) for the comparison line.
      series: period.buckets.map((b) => ({
        label: b.label,
        start: b.start.toISOString(),
        ...salesTotals(inRange(b.start, b.end)),
        previous: ordersCoverPrevious ? salesTotals(inRange(shift(b.start), shift(b.end))) : null,
      })),
      hasData: orderRows.length > 0,
      demo: orderRows.some((r) => r.source === "demo"),
      updatedAt: lastOrdersSync,
    },
    ads: {
      current: adsTotals(adsIn(period.start, period.end)),
      previous: adsCoverPrevious ? adsTotals(adsIn(period.prevStart, period.prevEnd)) : null,
      // Ads are daily, so hourly charts don't apply: one point per bucket of a day or longer.
      // Buckets Amazon hasn't reported yet (e.g. today) are left empty rather than shown as zero.
      series:
        period.granularity === "hour"
          ? []
          : period.buckets.map((b) => {
              const rows = adsIn(b.start, b.end);
              const prevRows = adsCoverPrevious ? adsIn(shift(b.start), shift(b.end)) : [];
              return {
                label: b.label,
                start: b.start.toISOString(),
                reported: rows.length > 0,
                ...adsTotals(rows),
                previous: prevRows.length ? adsTotals(prevRows) : null,
              };
            }),
      hasData: adRows.length > 0,
      demo: adRows.some((r) => r.source === "demo"),
      latestDay: adRows.reduce<string | null>((max, r) => (!max || r.date > max ? r.date : max), null),
    },
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
