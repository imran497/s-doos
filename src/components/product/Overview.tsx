import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { BandHistory, LineChart } from "@/components/charts";
import { Panel } from "@/components/Panel";
import { RankBadge } from "@/components/RankBadge";
import { buttonVariants } from "@/components/ui/button";
import { TrackButton } from "@/components/product/SmallActions";
import { bandCounts, bands, NOT_FOUND_COLOR, PAGE_SIZE, plural, type KeywordTrend } from "@/lib/insights";
import { compact } from "@/lib/metrics";
import type { ProductDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";

function MoverList({ title, items, empty, tone }: { title: string; items: KeywordTrend[]; empty: string; tone: "up" | "down" }) {
  const Icon = tone === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Icon className={cn("size-3.5", tone === "up" ? "text-positive" : "text-destructive")} />
          {title}
        </span>
      }
    >
      {items.length ? (
        <ul className="space-y-2.5">
          {items.map((t) => (
            <li key={t.keyword.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] font-medium">{t.keyword.keyword}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={cn("text-[13px] font-medium tabular-nums", tone === "up" ? "text-positive" : "text-destructive")}>
                  {tone === "up" ? "▲" : "▼"} {Math.abs(t.delta!)}
                </span>
                <RankBadge rank={t.now} size="sm" />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      )}
    </Panel>
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
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-brand" /> Opportunities
          </span>
        }
      >
        {untracked.length ? (
          <ul className="space-y-2.5">
            {untracked.map((q) => (
              <li key={q.search_query} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{q.search_query}</span>
                  <span className="text-xs text-muted-foreground">{compact(q.query_volume)} searches/week · not tracked</span>
                </span>
                <TrackButton productId={productId} keyword={q.search_query} />
              </li>
            ))}
          </ul>
        ) : almost.length ? (
          <ul className="space-y-2.5">
            {almost.map((t) => (
              <li key={t.keyword.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{t.keyword.keyword}</span>
                  <span className="text-xs text-muted-foreground">{t.now! - PAGE_SIZE} spots from page 1</span>
                </span>
                <RankBadge rank={t.now} size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Sync your SQP report to see search queries you&apos;re not tracking yet.</p>
        )}
      </Panel>
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
    <Panel
      title="Where you stand"
      meta={total ? `${onPage1} of ${plural(total, "keyword")} on page 1` : "No checks yet"}
      actions={
        <Link href={`/products/${detail.product.id}?tab=keywords`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          See every keyword
        </Link>
      }
    >
      {total > 0 && (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-canvas">
            {segments.map((s) => s.n > 0 && <div key={s.key} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} />)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {segments.map((s) => (
              <div key={s.key} className="rounded-md border px-3.5 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: s.color }} /> {s.label}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{s.n}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className={cn("grid gap-8 lg:grid-cols-2", total > 0 && "mt-6")}>
        <div>
          <p className="mb-3 text-[13px] font-medium">Rank bands over time</p>
          <BandHistory days={detail.summaries} />
        </div>
        <div>
          <p className="mb-3 text-[13px] font-medium" title="Share of search traffic you'd capture vs. ranking #1 for every keyword, weighted by search volume.">
            Visibility score
          </p>
          <LineChart points={detail.summaries.map((d) => ({ label: d.date, value: d.checked ? d.visibility : null }))} format={(v) => `${v}%`} />
        </div>
      </div>
    </Panel>
  );
}
