import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Info, Sparkles, Star } from "lucide-react";
import { BandHistory, LineChart } from "@/components/charts";
import { RankBadge } from "@/components/RankBadge";
import { TrackButton } from "@/components/product/SmallActions";
import { bandCounts, bands, greeting, NOT_FOUND_COLOR, PAGE_SIZE, plural, type Briefing, type KeywordTrend } from "@/lib/insights";
import { compact } from "@/lib/metrics";
import type { ProductDetail } from "@/lib/queries";

export function BriefingCard({ briefing, latestDate }: { briefing: Briefing; latestDate: string | null }) {
  const icon = {
    up: <ArrowUpRight className="size-4 text-brand" />,
    down: <ArrowDownRight className="size-4 text-coral" />,
    star: <Star className="size-4 text-gold" />,
    info: <Info className="size-4 text-muted-foreground" />,
  };
  return (
    <section className="relative overflow-hidden rounded-3xl bg-ink p-7 text-white sm:p-9">
      <div
        aria-hidden="true"
        className="absolute -right-24 -top-24 size-72 rounded-full opacity-40 blur-3xl"
        style={{ background: briefing.tone === "down" ? "var(--color-coral)" : "var(--color-brand)" }}
      />
      <p className="eyebrow relative text-white/60">{latestDate ? `Briefing · ${formatDate(latestDate)}` : "Briefing"}</p>
      <h2 className="relative mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
        {greeting()}. {briefing.tone === "up" ? "You're climbing." : briefing.tone === "down" ? "A few things slipped." : "Here's your week."}
      </h2>
      <ul className="relative mt-6 space-y-3">
        {briefing.lines.map((l, i) => (
          <li key={i} className="flex items-start gap-3 text-[15px] leading-snug text-white/90">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white">{icon[l.kind]}</span>
            {l.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MoverList({ title, items, empty, tone }: { title: string; items: KeywordTrend[]; empty: string; tone: "up" | "down" }) {
  return (
    <div className="card p-6">
      <p className="eyebrow flex items-center gap-1.5">
        {tone === "up" ? <ArrowUpRight className="size-3.5 text-brand" /> : <ArrowDownRight className="size-3.5 text-coral" />}
        {title}
      </p>
      {items.length ? (
        <ul className="mt-4 space-y-3">
          {items.map((t) => (
            <li key={t.keyword.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-semibold">{t.keyword.keyword}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`text-sm font-bold tabular-nums ${tone === "up" ? "text-brand" : "text-coral"}`}>
                  {tone === "up" ? "▲" : "▼"} {Math.abs(t.delta!)}
                </span>
                <RankBadge rank={t.now} size="sm" />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function MoversAndOpportunities({ productId, trends, sqpQueries }: {
  productId: number;
  trends: KeywordTrend[];
  sqpQueries: { search_query: string; query_volume: number | null; tracked: 0 | 1 }[];
}) {
  const winners = trends.filter((t) => (t.delta ?? 0) > 0).sort((a, b) => b.delta! - a.delta!).slice(0, 4);
  const losers = trends.filter((t) => (t.delta ?? 0) < 0).sort((a, b) => a.delta! - b.delta!).slice(0, 4);
  const untracked = sqpQueries.filter((q) => !q.tracked).slice(0, 4);
  // Without SQP data, the best opportunities are keywords sitting just past page 1.
  const almost = trends
    .filter((t) => t.now != null && t.now > PAGE_SIZE && t.now <= PAGE_SIZE * 1.5)
    .sort((a, b) => (b.keyword.volume ?? 0) - (a.keyword.volume ?? 0) || a.now! - b.now!)
    .slice(0, 4);

  return (
    <div className="grid gap-5 md:grid-cols-3">
      <MoverList title="Winners this week" tone="up" items={winners} empty="No keyword moved up this week." />
      <MoverList title="Losers this week" tone="down" items={losers} empty="Nothing dropped. Nice." />
      <div className="card bg-gradient-to-br from-white to-brand-soft/60 p-6">
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-gold" /> Opportunities
        </p>
        {untracked.length ? (
          <ul className="mt-4 space-y-3">
            {untracked.map((q) => (
              <li key={q.search_query} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{q.search_query}</span>
                  <span className="text-xs text-muted-foreground">{compact(q.query_volume)} searches/week · not tracked</span>
                </span>
                <TrackButton productId={productId} keyword={q.search_query} />
              </li>
            ))}
          </ul>
        ) : almost.length ? (
          <ul className="mt-4 space-y-3">
            {almost.map((t) => (
              <li key={t.keyword.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{t.keyword.keyword}</span>
                  <span className="text-xs text-muted-foreground">{t.now! - PAGE_SIZE} spots from page 1</span>
                </span>
                <RankBadge rank={t.now} size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Sync your SQP report to see search queries you&apos;re not tracking yet.</p>
        )}
      </div>
    </div>
  );
}

export function Standing({ detail, trends }: { detail: ProductDetail; trends: KeywordTrend[] }) {
  const checked = trends.filter((t) => t.checkedNow);
  const counts = bandCounts(checked.map((t) => t.now));
  const total = checked.length;
  const segments = [
    ...bands.map((b) => ({ key: b.key, label: b.label, color: b.color, n: counts[b.key] })),
    { key: "none" as const, label: "Not found", color: NOT_FOUND_COLOR, n: counts.none },
  ];
  const onPage1 = counts.top3 + counts.page1;

  return (
    <section className="card p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Where you stand</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">
            {total ? (
              <>
                {onPage1} of {plural(total, "keyword")} on page 1
              </>
            ) : (
              "No checks yet"
            )}
          </p>
        </div>
        <Link href={`/products/${detail.product.id}?tab=keywords`} className="btn">
          See every keyword
        </Link>
      </div>

      {total > 0 && (
        <>
          <div className="mt-6 flex h-4 overflow-hidden rounded-full bg-canvas">
            {segments.map((s) => s.n > 0 && <div key={s.key} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} />)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {segments.map((s) => (
              <div key={s.key} className="rounded-2xl bg-canvas px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <span className="size-2.5 rounded-full" style={{ background: s.color }} /> {s.label}
                </p>
                <p className="mt-1 text-xl font-extrabold tabular-nums">{s.n}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-bold">Rank bands over time</p>
          <BandHistory days={detail.summaries} />
        </div>
        <div>
          <p className="mb-3 text-sm font-bold" title="Share of search traffic you'd capture vs. ranking #1 for every keyword, weighted by search volume.">
            Visibility score
          </p>
          <LineChart points={detail.summaries.map((d) => ({ label: d.date, value: d.checked ? d.visibility : null }))} format={(v) => `${v}%`} />
        </div>
      </div>
    </section>
  );
}

export const formatDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
