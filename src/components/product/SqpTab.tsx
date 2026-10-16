"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { formatValue } from "@/components/dashboard/format";
import { TrackButton } from "@/components/product/SmallActions";
import { Input } from "@/components/ui/input";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PeriodKey } from "@/lib/periods";
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

export function SqpTab({ productId, data, currency, period }: {
  productId: number;
  data: SqpPerformance;
  currency: string;
  period: { key: PeriodKey; from: string; to: string; label: string };
}) {
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

  const t = data.totals;
  if (!t) {
    // Nothing in the chosen dates: just the explanation and the date picker.
    return (
      <div className="flex flex-col-reverse gap-3 rounded-lg border border-dashed bg-card px-5 py-6 lg:flex-row lg:items-center lg:justify-between">
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          No weekly report covers {period.label.toLowerCase()}. Amazon publishes each week a few days after it ends
          {data.latest ? `; the latest is ${data.latest.label}. Try “Last 30 days” or a custom range.` : "."}
        </p>
        <DashboardControls period={period.key} from={period.from} to={period.to} marketplace="US" marketplaceOptions={[]} />
      </div>
    );
  }

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

  return (
    <div className="space-y-5">
      <div className="flex flex-col-reverse gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          Showing <b className="font-medium text-foreground">{data.covered?.label}</b>. Amazon reports search queries per Sunday–Saturday week, so your
          dates are rounded to the weeks they touch.
        </p>
        <DashboardControls period={period.key} from={period.from} to={period.to} marketplace="US" marketplaceOptions={[]} />
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
