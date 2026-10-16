"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { formatValue } from "@/components/dashboard/format";
import { TrackButton } from "@/components/product/SmallActions";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SqpPerformance, SqpQueryRow } from "@/lib/sqp";
import { cn } from "@/lib/utils";

const share = (part: number, whole: number) => (whole ? part / whole : null);
/** Percent with enough decimals to tell small shares apart (0.03%, not 0.0%). */
const pct = (n: number | null, digits = 1) => {
  if (n == null) return "—";
  const p = n * 100;
  if (p === 0) return "0%";
  const places = p < 0.1 ? 3 : p < 1 ? 2 : digits;
  return `${p.toFixed(places)}%`;
};
const int = (n: number) => n.toLocaleString();

type SortKey = "query" | "rank" | "searches" | "asinImpressions" | "asinClicks" | "ctr" | "asinCartAdds" | "asinPurchases" | "conversion" | "purchaseShare";

const sortValue = (r: SqpQueryRow, key: SortKey): number | string => {
  switch (key) {
    case "query":
      return r.query;
    case "rank":
      return r.rank ?? Number.MAX_SAFE_INTEGER;
    case "ctr":
      return share(r.asinClicks, r.asinImpressions) ?? -1;
    case "conversion":
      return share(r.asinPurchases, r.asinClicks) ?? -1;
    case "purchaseShare":
      return share(r.asinPurchases, r.purchases) ?? -1;
    default:
      return r[key];
  }
};

export function SqpTab({ productId, data, currency }: { productId: number; data: SqpPerformance; currency: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "searches", desc: true });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? data.rows.filter((r) => r.query.includes(q)) : data.rows;
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
  }, [data.rows, query, sort]);

  if (!data.period || !data.totals) return null;
  const t = data.totals;
  const setPeriod = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", "queries");
    next.set("week", key);
    router.push(`${pathname}?${next}`, { scroll: false });
  };

  const cards = [
    { label: "Searches", value: int(t.searches), note: `${t.queries} search queries that showed your product` },
    { label: "Impressions", value: int(t.asinImpressions), note: `${pct(share(t.asinImpressions, t.impressions))} of all impressions` },
    { label: "Clicks", value: int(t.asinClicks), note: `${pct(share(t.asinClicks, t.clicks))} click share · ${pct(share(t.asinClicks, t.asinImpressions), 2)} CTR` },
    { label: "Cart adds", value: int(t.asinCartAdds), note: `${pct(share(t.asinCartAdds, t.cartAdds))} of all cart adds` },
    { label: "Purchases", value: int(t.asinPurchases), note: `${pct(share(t.asinPurchases, t.purchases))} purchase share · ${pct(share(t.asinPurchases, t.asinClicks))} of clicks` },
    {
      label: "Sessions",
      value: data.sessions?.sessions != null ? int(data.sessions.sessions) : "—",
      note: data.sessions ? `Product page visits from all sources (${data.sessions.days} days)` : "From the Sales & Traffic report, not reported for these days yet",
    },
  ];

  const funnel = [
    { stage: "Impressions", yours: t.asinImpressions, all: t.impressions },
    { stage: "Clicks", yours: t.asinClicks, all: t.clicks },
    { stage: "Cart adds", yours: t.asinCartAdds, all: t.cartAdds },
    { stage: "Purchases", yours: t.asinPurchases, all: t.purchases },
  ];
  const maxShare = Math.max(0.0001, ...funnel.map((f) => share(f.yours, f.all) ?? 0));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">Amazon Brand Analytics: how shoppers found and bought your product, by what they searched for.</p>
        <Select value={data.period.key} onValueChange={setPeriod}>
          <SelectTrigger size="sm" className="h-8 w-auto gap-2 text-[13px] font-medium" aria-label="Week">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {data.periods.map((p) => (
              <SelectItem key={p.key} value={p.key} className="text-[13px]">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-card px-4 py-3.5 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
            <p className="text-[13px] font-medium text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{c.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
          </div>
        ))}
      </div>

      <section className="rounded-lg border bg-card px-5 py-4 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Your share of each step</h3>
          <span className="text-xs text-muted-foreground">Across these {t.queries} search queries: you vs. all products shoppers saw</span>
        </div>
        <div className="mt-3 space-y-2.5">
          {funnel.map((f) => {
            const s = share(f.yours, f.all);
            return (
              <div key={f.stage} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-[13px] sm:grid-cols-[110px_1fr_220px]">
                <span className="text-muted-foreground">{f.stage}</span>
                <span className="h-2 overflow-hidden rounded-full bg-canvas">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${((s ?? 0) / maxShare) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">
                  <b className="font-semibold">{pct(s)}</b>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {int(f.yours)} of {int(f.all)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-[13px] font-semibold">
            Search queries <span className="font-normal text-muted-foreground">({rows.length})</span>
          </p>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter search queries" className="h-8 pl-8 text-[13px]" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead className="bg-canvas text-xs text-muted-foreground">
              <tr className="border-b">
                <SortHeader sort={sort} onSort={setSort} k="query" label="Search query" align="left" />
                <SortHeader sort={sort} onSort={setSort} k="rank" label="Rank" hint="Amazon's rank of this query by search volume (1 = most searched)" />
                <SortHeader sort={sort} onSort={setSort} k="searches" label="Searches" hint="Times shoppers searched this query" />
                <SortHeader sort={sort} onSort={setSort} k="asinImpressions" label="Impressions" hint="Your impressions; below, your share of all impressions" />
                <SortHeader sort={sort} onSort={setSort} k="asinClicks" label="Clicks" hint="Your clicks, and your share of all clicks" />
                <SortHeader sort={sort} onSort={setSort} k="ctr" label="CTR" hint="Your clicks ÷ your impressions" />
                <SortHeader sort={sort} onSort={setSort} k="asinCartAdds" label="Cart adds" hint="Your cart adds, and your share of all cart adds" />
                <SortHeader sort={sort} onSort={setSort} k="asinPurchases" label="Purchases" hint="Your purchases, and your share of all purchases" />
                <SortHeader sort={sort} onSort={setSort} k="conversion" label="Conversion" hint="Your purchases ÷ your clicks" />
                <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap" title="Median price shoppers clicked at: yours vs. all products">
                  Click price
                </th>
                <th className="w-24 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.query} className="border-b last:border-0 hover:bg-canvas/50">
                  <td className="max-w-[260px] px-3 py-2.5 font-medium">
                    <span className="block truncate" title={r.query}>
                      {r.query}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{r.rank ? `#${int(r.rank)}` : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{int(r.searches)}</td>
                  <Pair yours={r.asinImpressions} all={r.impressions} />
                  <Pair yours={r.asinClicks} all={r.clicks} />
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(share(r.asinClicks, r.asinImpressions), 2)}</td>
                  <Pair yours={r.asinCartAdds} all={r.cartAdds} />
                  <Pair yours={r.asinPurchases} all={r.purchases} strong />
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(share(r.asinPurchases, r.asinClicks))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.asinClickPrice == null && r.marketClickPrice == null ? (
                      "—"
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">
                            {r.asinClickPrice == null ? "—" : formatValue("money", r.asinClickPrice, currency)}
                            <span className="block text-[11px] text-muted-foreground">
                              market {r.marketClickPrice == null ? "—" : formatValue("money", r.marketClickPrice, currency)}
                            </span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Median price shoppers clicked at: yours vs. all products for this search</TooltipContent>
                      </Tooltip>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.tracked ? <span className="text-xs font-medium text-brand">Tracking</span> : <TrackButton productId={productId} keyword={r.query} />}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-muted-foreground">
                    No search queries match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Your count, with your share of the total underneath. */
function Pair({ yours, all, strong }: { yours: number; all: number; strong?: boolean }) {
  return (
    <td className="px-3 py-2.5 text-right tabular-nums">
      <span className={strong ? "font-semibold" : undefined}>{int(yours)}</span>
      <span className="block text-[11px] whitespace-nowrap text-muted-foreground" title="Your share of all products">
        {pct(share(yours, all))}
      </span>
    </td>
  );
}

type Sort = { key: SortKey; desc: boolean };

/** A column title that sorts the table; clicking again flips the direction. */
function SortHeader({ k, label, hint, align = "right", sort, onSort }: {
  k: SortKey;
  label: string;
  hint?: string;
  align?: "left" | "right";
  sort: Sort;
  onSort: (update: (s: Sort) => Sort) => void;
}) {
  return (
    <th className={cn("px-3 py-2.5 font-medium whitespace-nowrap", align === "left" ? "text-left" : "text-right")}>
      <button
        type="button"
        onClick={() => onSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "query" && k !== "rank" }))}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", sort.key === k && "text-foreground")}
        title={hint}
      >
        {label}
        {sort.key === k && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}
