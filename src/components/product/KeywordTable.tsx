"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Tag, Trash2 } from "lucide-react";
import { checkNow, deleteKeywords, updateTags } from "@/app/actions";
import { Sparkline } from "@/components/charts";
import { RankBadge } from "@/components/RankBadge";
import type { KeywordTrend } from "@/lib/insights";
import type { KeywordAds } from "@/lib/commerce";
import { compact, formatMoney, pct, percent } from "@/lib/metrics";

type SortKey = "keyword" | "volume" | "rank" | "change";

const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function KeywordTable({ productId, amazonDomain, trends, dates, mode, view, hasSqp, ads, currency }: {
  productId: number;
  /** e.g. amazon.com, used to link each keyword to its live search results. */
  amazonDomain: string;
  trends: KeywordTrend[];
  /** Oldest first. */
  dates: string[];
  mode: "organic" | "sponsored";
  view: "list" | "grid";
  hasSqp: boolean;
  /** Last-7-day Sponsored Products numbers per keyword, when ads data exists. */
  ads: KeywordAds | null;
  currency: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string>();

  const rows = useMemo(() => {
    const value = (t: KeywordTrend): string | number | null =>
      sort.key === "keyword" ? t.keyword.keyword : sort.key === "volume" ? t.keyword.volume : sort.key === "rank" ? t.now : t.delta;
    return [...trends].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // blanks always last
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [trends, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "volume" || key === "change" ? -1 : 1 }));

  const allSelected = trends.length > 0 && selected.size === trends.length;
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ids = [...selected];
  const columns = [...dates].reverse();
  const head = "px-3 py-3 text-xs font-semibold text-muted-foreground";

  return (
    <div className="card overflow-hidden">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-ink px-5 py-3 text-sm text-white">
          <span className="font-semibold">{selected.size} selected</span>
          <button
            type="button"
            className="btn border-white/20 bg-white/10 py-1.5 text-white hover:bg-white/20"
            disabled={pending}
            onClick={() => start(async () => setMessage((await checkNow(productId, ids))?.message))}
          >
            <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} /> Check now
          </button>
          <button
            type="button"
            className="btn border-coral/40 bg-coral/15 py-1.5 text-white hover:bg-coral/30"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Stop tracking ${selected.size} keyword(s)? Their rank history is deleted too.`)) return;
              start(async () => {
                await deleteKeywords(productId, ids);
                setSelected(new Set());
              });
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
          {message && <span className="text-white/70">{message}</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left">
            <tr>
              <th className="w-10 py-3 pl-5">
                <input
                  type="checkbox"
                  aria-label="Select all keywords"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(trends.map((t) => t.keyword.id)))}
                  className="accent-[var(--color-brand)]"
                />
              </th>
              <th className={`${head} min-w-56`}>
                <SortButton label="Keyword" k="keyword" sort={sort} onSort={toggleSort} />
              </th>
              <th className={`${head} text-right`}>
                <SortButton label="Searches / mo" k="volume" sort={sort} onSort={toggleSort} />
              </th>
              {view === "list" ? (
                <>
                  <th className={`${head} text-center`}>
                    <SortButton label={mode === "organic" ? "Rank" : "Ad rank"} k="rank" sort={sort} onSort={toggleSort} />
                  </th>
                  <th className={`${head} text-right`}>
                    <SortButton label="7-day change" k="change" sort={sort} onSort={toggleSort} />
                  </th>
                  <th className={head}>Trend</th>
                  {hasSqp && <th className={`${head} text-right`}>Click share</th>}
                  {hasSqp && <th className={`${head} ${ads ? "" : "pr-5"} text-right`}>Sales share</th>}
                  {ads && <th className={`${head} text-right`} title="Sponsored Products, last 7 days">Ad clicks</th>}
                  {ads && <th className={`${head} text-right`}>Ad spend</th>}
                  {ads && <th className={`${head} pr-5 text-right`}>ACoS</th>}
                </>
              ) : (
                columns.map((d) => (
                  <th key={d} className="whitespace-nowrap px-1 py-3 text-center text-[11px] font-semibold text-muted-foreground">
                    {shortDate(d)}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((t) => {
              const k = t.keyword;
              return (
                <tr key={k.id} className={selected.has(k.id) ? "bg-brand-soft/50" : "hover:bg-canvas/60"}>
                  <td className="py-3 pl-5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${k.keyword}`}
                      checked={selected.has(k.id)}
                      onChange={() => toggle(k.id)}
                      className="accent-[var(--color-brand)]"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <a
                      href={`https://www.${amazonDomain}/s?k=${encodeURIComponent(k.keyword)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:text-brand"
                    >
                      {k.keyword}
                    </a>
                    <TagLine keywordId={k.id} tags={k.tags} />
                  </td>
                  <td
                    className="px-3 py-3 text-right tabular-nums text-muted-foreground"
                    title={k.volumeSource === "sqp" ? "From your SQP report" : k.volumeSource === "estimate" ? "DataForSEO estimate" : undefined}
                  >
                    {compact(k.volume)}
                    {k.volumeSource === "estimate" && <span className="ml-0.5 text-muted-foreground/60">~</span>}
                  </td>
                  {view === "list" ? (
                    <>
                      <td className="px-3 py-3 text-center">
                        <RankBadge rank={t.now} checked={t.checkedNow} />
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">
                        {t.delta == null || t.delta === 0 ? (
                          <span className="font-medium text-muted-foreground">–</span>
                        ) : t.delta > 0 ? (
                          <span className="text-brand">▲ {t.delta}</span>
                        ) : (
                          <span className="text-coral">▼ {-t.delta}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Sparkline series={t.series} delta={t.delta} />
                      </td>
                      {hasSqp && <td className="px-3 py-3 text-right tabular-nums">{pct(k.sqp?.asin_clicks, k.sqp?.clicks)}</td>}
                      {hasSqp && <td className={`py-3 pl-3 ${ads ? "pr-3" : "pr-5"} text-right tabular-nums`}>{pct(k.sqp?.asin_purchases, k.sqp?.purchases)}</td>}
                      {ads && <td className="px-3 py-3 text-right tabular-nums">{ads[k.keyword]?.clicks ?? "–"}</td>}
                      {ads && <td className="px-3 py-3 text-right tabular-nums">{ads[k.keyword] ? formatMoney(ads[k.keyword].cost, currency) : "–"}</td>}
                      {ads && (
                        <td className="py-3 pl-3 pr-5 text-right font-semibold tabular-nums">
                          {ads[k.keyword] ? (ads[k.keyword].acos == null ? <span className="whitespace-nowrap text-coral">no sales</span> : percent(ads[k.keyword].acos, 0)) : "–"}
                        </td>
                      )}
                    </>
                  ) : (
                    columns.map((d) => (
                      <td key={d} className="px-0.5 py-3 text-center" title={`${k.keyword} · ${d}`}>
                        <RankBadge rank={k.ranks[d]?.[mode] ?? null} checked={Boolean(k.ranks[d])} size="sm" />
                      </td>
                    ))
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!trends.length && <p className="p-10 text-center text-sm text-muted-foreground">No keywords match.</p>}
      </div>
    </div>
  );
}

function SortButton({ label, k, sort, onSort }: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
}) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={() => onSort(k)} className={`inline-flex cursor-pointer items-center gap-1 hover:text-ink ${sort.key === k ? "text-ink" : ""}`}>
      {label}
      <Icon className="size-3" />
    </button>
  );
}

/** Tags under the keyword; click to edit as a comma-separated list. */
function TagLine({ keywordId, tags }: { keywordId: number; tags: string }) {
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={tags}
        placeholder="tag, another tag"
        className="field mt-1 max-w-64 py-1 text-xs"
        onBlur={(e) => {
          const value = e.currentTarget.value;
          setEditing(false);
          if (value !== tags) start(() => updateTags(keywordId, value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="mt-1 flex cursor-pointer flex-wrap items-center gap-1 text-left">
      {tags ? (
        tags.split(", ").map((t) => (
          <span key={t} className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {t}
          </span>
        ))
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground">
          <Tag className="size-3" /> tag
        </span>
      )}
    </button>
  );
}
