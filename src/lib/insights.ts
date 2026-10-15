// Turns raw daily ranks into the takeaways shown on the Overview: what moved, where things stand,
// and what to do next. Pure functions, shared by the product page and the product cards.
import { addDays } from "./dates";
import type { KeywordRow } from "./queries";

/** Roughly how many organic results Amazon shows per search page. */
export const PAGE_SIZE = 48;

export const bands = [
  { key: "top3", label: "Top 3", short: "Top 3", test: (r: number) => r <= 3, color: "var(--color-band-top3)" },
  { key: "page1", label: "Page 1", short: "Pg 1", test: (r: number) => r <= PAGE_SIZE, color: "var(--color-band-page1)" },
  { key: "page2", label: "Page 2", short: "Pg 2", test: (r: number) => r <= PAGE_SIZE * 2, color: "var(--color-band-page2)" },
  { key: "beyond", label: "Beyond", short: "3+", test: () => true, color: "var(--color-band-beyond)" },
] as const;

export type BandKey = (typeof bands)[number]["key"] | "none";

export const bandOf = (rank: number | null): BandKey => (rank == null ? "none" : bands.find((b) => b.test(rank))!.key);

export const NOT_FOUND_COLOR = "var(--color-band-none)";

export type Mode = "organic" | "sponsored";

export type KeywordTrend = {
  keyword: KeywordRow;
  /** Rank on the latest day; null if not found or not checked that day. */
  now: number | null;
  checkedNow: boolean;
  before: number | null;
  /** False when there's no earlier check to compare against (e.g. a keyword added this week). */
  compared: boolean;
  /** Positive = moved up (better). Null when either side wasn't ranked. */
  delta: number | null;
  series: (number | null)[];
};

/** Latest rank vs. the rank `lookback` days earlier, for every keyword. */
export function keywordTrends(keywords: KeywordRow[], dates: string[], latestDate: string | null, mode: Mode = "organic", lookback = 7) {
  const compareDate = latestDate ? addDays(latestDate, -lookback) : null;
  return keywords.map((k): KeywordTrend => {
    const now = latestDate && k.ranks[latestDate] ? k.ranks[latestDate][mode] : null;
    // Use the closest checked day on or before the compare date, falling back to the first day in range.
    const earlier = compareDate ? dates.filter((d) => d <= compareDate && k.ranks[d]).at(-1) ?? dates.find((d) => k.ranks[d] && d !== latestDate) : undefined;
    const before = earlier ? k.ranks[earlier][mode] : null;
    return {
      keyword: k,
      now,
      checkedNow: Boolean(latestDate && k.ranks[latestDate]),
      before,
      compared: Boolean(earlier),
      delta: now != null && before != null ? before - now : null,
      series: dates.map((d) => k.ranks[d]?.[mode] ?? null),
    };
  });
}

export function bandCounts(ranks: (number | null)[]) {
  const counts: Record<BandKey, number> = { top3: 0, page1: 0, page2: 0, beyond: 0, none: 0 };
  for (const r of ranks) counts[bandOf(r)]++;
  return counts;
}

const onPage1 = (r: number | null) => r != null && r <= PAGE_SIZE;

export type Briefing = {
  tone: "up" | "down" | "flat";
  lines: { kind: "up" | "down" | "star" | "info"; text: string }[];
};

/** Up to four plain-language takeaways for the week. */
/** Extra takeaways from sales, ads, stock and competitors; lower priority shows first. */
export type BriefingSignal = { kind: "up" | "down" | "star" | "info"; text: string; priority: number };

/**
 * Up to five plain-language takeaways. Urgent business signals (low stock, Buy Box, competitor price
 * cuts: priority ≤ 1) lead, then rank moves, then the rest.
 */
export function buildBriefing(trends: KeywordTrend[], untrackedQueries: number, signals: BriefingSignal[] = []): Briefing {
  const rankLines: Briefing["lines"] = [];
  const checked = trends.filter((t) => t.now != null || t.before != null);

  const entered = trends.filter((t) => t.compared && onPage1(t.now) && !onPage1(t.before));
  const left = trends.filter((t) => t.compared && t.checkedNow && !onPage1(t.now) && onPage1(t.before));
  const gains = trends.filter((t) => (t.delta ?? 0) > 0).sort((a, b) => b.delta! - a.delta!);
  const drops = trends.filter((t) => (t.delta ?? 0) < 0).sort((a, b) => a.delta! - b.delta!);

  if (!checked.length) rankLines.push({ kind: "info", text: "No rank checks yet. Click “Check now” to take the first snapshot." });
  if (entered.length) rankLines.push({ kind: "up", text: `${plural(entered.length, "keyword")} reached page 1${entered.length === 1 ? `: “${entered[0].keyword.keyword}”` : ""}.` });
  if (left.length) rankLines.push({ kind: "down", text: `${plural(left.length, "keyword")} fell off page 1${left.length === 1 ? `: “${left[0].keyword.keyword}”` : ""}.` });
  if (gains[0] && !entered.includes(gains[0])) rankLines.push({ kind: "up", text: `“${gains[0].keyword.keyword}” climbed from #${gains[0].before} to #${gains[0].now}.` });
  if (drops[0] && !left.includes(drops[0])) rankLines.push({ kind: "down", text: `“${drops[0].keyword.keyword}” slipped from #${drops[0].before} to #${drops[0].now}.` });
  if (untrackedQueries) rankLines.push({ kind: "star", text: `${plural(untrackedQueries, "search query", "search queries")} from your SQP report ${untrackedQueries === 1 ? "isn't" : "aren't"} tracked yet.` });

  const urgent = signals.filter((s) => s.priority <= 1);
  const rest = signals.filter((s) => s.priority > 1);
  const lines = [...urgent, ...rankLines, ...rest].map(({ kind, text }) => ({ kind, text })).slice(0, 5);
  if (!lines.length) lines.push({ kind: "info", text: "A steady week. No keyword moved more than a few spots." });

  const net = gains.reduce((s, t) => s + t.delta!, 0) + drops.reduce((s, t) => s + t.delta!, 0);
  const tone = urgent.some((s) => s.kind === "down") ? "down" : net > 0 ? "up" : net < 0 ? "down" : "flat";
  return { tone, lines };
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
