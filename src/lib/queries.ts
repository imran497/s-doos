import "server-only";
import { connection } from "next/server";
import { addDays, db, today } from "./db";
import type { MarketplaceCode } from "./marketplaces";
import { bandCounts, type BandKey } from "./insights";
import { visibilityScore } from "./metrics";

// Every query awaits connection() first: better-sqlite3 is synchronous, so without it the
// results would be frozen into the page at build time.

export type Product = {
  id: number;
  asin: string;
  marketplace: MarketplaceCode;
  title: string | null;
  image_url: string | null;
  created_at: string;
};

export async function listProducts() {
  await connection();
  return db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM keywords k WHERE k.product_id = p.id) AS keyword_count,
         (SELECT MAX(rc.checked_on) FROM rank_checks rc JOIN keywords k ON k.id = rc.keyword_id WHERE k.product_id = p.id) AS last_checked,
         (SELECT ROUND(AVG(rc.organic_rank)) FROM rank_checks rc JOIN keywords k ON k.id = rc.keyword_id
            WHERE k.product_id = p.id AND rc.checked_on = (SELECT MAX(checked_on) FROM rank_checks rc2 JOIN keywords k2 ON k2.id = rc2.keyword_id WHERE k2.product_id = p.id)
              AND rc.organic_rank IS NOT NULL) AS avg_organic,
         (SELECT COUNT(*) FROM rank_checks rc JOIN keywords k ON k.id = rc.keyword_id
            WHERE k.product_id = p.id AND rc.checked_on = (SELECT MAX(checked_on) FROM rank_checks rc2 JOIN keywords k2 ON k2.id = rc2.keyword_id WHERE k2.product_id = p.id)
              AND rc.organic_rank IS NOT NULL) AS ranking_organic
       FROM products p ORDER BY p.created_at DESC`,
    )
    .all() as (Product & {
    keyword_count: number;
    last_checked: string | null;
    avg_organic: number | null;
    ranking_organic: number;
  })[];
}

export type KeywordRow = {
  id: number;
  keyword: string;
  tags: string;
  /** Monthly searches: from your SQP report when available (weekly × 52/12), else DataForSEO's estimate. */
  volume: number | null;
  volumeSource: "sqp" | "estimate" | null;
  ranks: Record<string, { organic: number | null; sponsored: number | null }>;
  sqp: {
    query_volume: number | null;
    impressions: number | null;
    asin_impressions: number | null;
    clicks: number | null;
    asin_clicks: number | null;
    cart_adds: number | null;
    asin_cart_adds: number | null;
    purchases: number | null;
    asin_purchases: number | null;
  } | null;
};

export type DaySummary = {
  date: string;
  /** How many keywords were checked that day. */
  checked: number;
  avgOrganic: number | null;
  avgSponsored: number | null;
  visibility: number;
  /** How many keywords sat in each organic rank band that day. */
  bands: Record<BandKey, number>;
};

/** Everything the product page needs, for the last `days` days. */
export async function getProductDetail(id: number, days: number) {
  await connection();
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Product | undefined;
  if (!product) return null;

  const end = today();
  const start = addDays(end, -(days - 1));
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));

  // SQP query volume is Amazon's own figure, so it wins over third-party estimates.
  const sqpWeek = (db.prepare("SELECT MAX(week_start) AS w FROM sqp_weekly WHERE product_id = ?").get(id) as { w: string | null }).w;
  const sqpRows = sqpWeek
    ? (db.prepare("SELECT * FROM sqp_weekly WHERE product_id = ? AND week_start = ?").all(id, sqpWeek) as (KeywordRow["sqp"] & {
        search_query: string;
        week_end: string;
      })[])
    : [];
  const sqpByQuery = new Map(sqpRows.map((r) => [r!.search_query, r]));

  const keywordRows = db.prepare("SELECT id, keyword, tags, est_volume FROM keywords WHERE product_id = ? ORDER BY keyword").all(id) as {
    id: number;
    keyword: string;
    tags: string;
    est_volume: number | null;
  }[];
  const checks = db
    .prepare(
      `SELECT rc.keyword_id, rc.checked_on, rc.organic_rank, rc.sponsored_rank, rc.source FROM rank_checks rc
       JOIN keywords k ON k.id = rc.keyword_id WHERE k.product_id = ? AND rc.checked_on BETWEEN ? AND ?`,
    )
    .all(id, start, end) as { keyword_id: number; checked_on: string; organic_rank: number | null; sponsored_rank: number | null; source: string }[];

  const keywords: KeywordRow[] = keywordRows.map(({ est_volume, ...k }) => {
    const sqp = sqpByQuery.get(k.keyword.toLowerCase()) ?? null;
    const sqpMonthly = sqp?.query_volume != null ? Math.round((sqp.query_volume * 52) / 12) : null;
    const volume = sqpMonthly ?? est_volume;
    return { ...k, volume, volumeSource: sqpMonthly != null ? "sqp" : est_volume != null ? "estimate" : null, sqp, ranks: {} };
  });
  const byId = new Map(keywords.map((k) => [k.id, k]));
  for (const c of checks) {
    const k = byId.get(c.keyword_id);
    if (k) k.ranks[c.checked_on] = { organic: c.organic_rank, sponsored: c.sponsored_rank };
  }

  const avg = (values: (number | null)[]) => {
    const ranked = values.filter((v): v is number => v != null);
    return ranked.length ? Math.round(ranked.reduce((a, b) => a + b, 0) / ranked.length) : null;
  };

  const summaries: DaySummary[] = dates.map((date) => {
    const checked = keywords.filter((k) => k.ranks[date]);
    return {
      date,
      checked: checked.length,
      avgOrganic: avg(checked.map((k) => k.ranks[date].organic)),
      avgSponsored: avg(checked.map((k) => k.ranks[date].sponsored)),
      visibility: checked.length ? visibilityScore(checked.map((k) => ({ rank: k.ranks[date].organic, volume: k.volume }))) : 0,
      bands: bandCounts(checked.map((k) => k.ranks[date].organic)),
    };
  });

  // Headline numbers come from the most recent day that has any checks.
  const latestDate = [...dates].reverse().find((d) => keywords.some((k) => k.ranks[d])) ?? null;
  const latest = latestDate ? keywords.filter((k) => k.ranks[latestDate]) : [];
  const sumVolume = (list: KeywordRow[]) => list.reduce((total, k) => total + (k.volume ?? 0), 0);
  const organicRanked = latest.filter((k) => k.ranks[latestDate!].organic != null);
  const sponsoredRanked = latest.filter((k) => k.ranks[latestDate!].sponsored != null);

  const bsr = db
    .prepare("SELECT checked_on, category, rank FROM bsr_snapshots WHERE product_id = ? AND checked_on BETWEEN ? AND ? ORDER BY checked_on")
    .all(id, start, end) as { checked_on: string; category: string; rank: number }[];

  return {
    product,
    dates,
    keywords,
    summaries,
    latestDate,
    isDemo: checks.some((c) => c.source === "demo"),
    sqpWeek: sqpRows[0] ? { start: sqpWeek!, end: sqpRows[0].week_end } : null,
    stats: {
      avgOrganic: latestDate ? avg(latest.map((k) => k.ranks[latestDate].organic)) : null,
      avgSponsored: latestDate ? avg(latest.map((k) => k.ranks[latestDate].sponsored)) : null,
      rankingOrganic: organicRanked.length,
      rankingSponsored: sponsoredRanked.length,
      volumeOrganic: sumVolume(organicRanked),
      volumeSponsored: sumVolume(sponsoredRanked),
      totalVolume: sumVolume(keywords),
    },
    bsr,
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>;

export async function getRecentRuns() {
  await connection();
  return db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 15").all() as {
    id: number;
    kind: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    message: string | null;
  }[];
}

/** Recent report requests, newest first, for the Settings page. */
export async function getReportQueue() {
  await connection();
  return db
    .prepare(
      `SELECT kind, scope, period_start, period_end, status, attempts, message, updated_at FROM report_requests
       ORDER BY (status IN ('queued', 'pending')) DESC, id DESC LIMIT 25`,
    )
    .all() as { kind: string; scope: string; period_start: string; period_end: string; status: string; attempts: number; message: string | null; updated_at: string }[];
}

/** All search queries from the latest SQP week, marking which ones are already tracked keywords. */
export async function getSqpQueries(productId: number) {
  await connection();
  return db
    .prepare(
      `SELECT s.*, EXISTS (SELECT 1 FROM keywords k WHERE k.product_id = s.product_id AND k.keyword = s.search_query) AS tracked
       FROM sqp_weekly s
       WHERE s.product_id = ? AND s.week_start = (SELECT MAX(week_start) FROM sqp_weekly WHERE product_id = ?)
       ORDER BY s.query_volume DESC NULLS LAST`,
    )
    .all(productId, productId) as (NonNullable<KeywordRow["sqp"]> & {
    search_query: string;
    week_start: string;
    week_end: string;
    tracked: 0 | 1;
  })[];
}
