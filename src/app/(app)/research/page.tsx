import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ResearchActions } from "@/components/product/CommerceForms";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { getResearch } from "@/lib/commerce";
import { marketplaces } from "@/lib/marketplaces";
import { percent } from "@/lib/metrics";
import { PageHeader } from "@/components/PageHeader";
import { Panel, tableStyles } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage(props: PageProps<"/research">) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Research"
        description="What shoppers search on Amazon: how popular each search is (rank 1 = most searched) and the three products shoppers click most, filtered to searches related to your keywords and competitors."
      />
      <Suspense fallback={<Skeleton className="h-64 rounded-lg" />}>
        <ResearchContent {...props} />
      </Suspense>
    </div>
  );
}

async function ResearchContent({ searchParams }: PageProps<"/research">) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().toLowerCase() ?? "";
  const onlyMine = sp.mine === "1";
  const data = await getResearch({ q, onlyMine });

  if (!data) {
    return (
      <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center text-[13px] text-muted-foreground">
        No search terms yet. They come from Amazon&apos;s Brand Analytics (Brand Registry needed). Connect Seller Central in{" "}
        <Link href="/settings#connect" className="font-medium text-brand">
          Settings
        </Link>{" "}
        and sync.
      </div>
    );
  }
  const domain = marketplaces[data.marketplace].domain;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-3" action="">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Filter searches" className="h-8 pl-8 text-[13px]" />
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="mine" value="1" defaultChecked={onlyMine} className="accent-[var(--color-brand)]" />
          Only where you&apos;re a top click
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {marketplaces[data.marketplace].flag} Week of {data.week} · {data.rows.length} searches{!isSpApiConfigured() && " · sample data"}
        </span>
      </form>

      <Panel title="Searches" meta="Your products are shown in indigo, competitors you watch in red" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={cn(tableStyles.table, "min-w-[860px]")}>
            <thead className={tableStyles.head}>
              <tr className="border-b text-left">
                <th>Search</th>
                <th className="text-right" title="Search frequency rank: 1 is Amazon's most searched term">
                  Popularity rank
                </th>
                <th className="text-right">vs last week</th>
                <th>Top clicked products (click share · conversion share)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const moved = r.prev_rank ? r.prev_rank - r.frequency_rank : null;
                const rivals = [...new Set(r.clicks.filter((c) => !c.yours && !c.watched).map((c) => c.asin))];
                return (
                  <tr key={r.term} className={cn(tableStyles.row, "align-top hover:bg-canvas/50")}>
                    <td>
                      <a href={`https://www.${domain}/s?k=${encodeURIComponent(r.term)}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-brand">
                        {r.term}
                      </a>
                      {r.tracked && <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-dark">Tracking</span>}
                    </td>
                    <td className="text-right font-medium tabular-nums">#{r.frequency_rank.toLocaleString()}</td>
                    <td
                      className={cn(
                        "text-right text-xs font-medium tabular-nums",
                        moved == null || Math.abs(moved) < 1 ? "text-muted-foreground" : moved > 0 ? "text-positive" : "text-destructive",
                      )}
                    >
                      {moved == null ? "new" : moved > 0 ? `▲ ${moved.toLocaleString()}` : moved < 0 ? `▼ ${(-moved).toLocaleString()}` : "–"}
                    </td>
                    <td>
                      <ol className="flex flex-wrap gap-1.5">
                        {r.clicks.map((c, i) => (
                          <li
                            key={c.asin}
                            className={cn(
                              "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                              c.yours ? "border-brand/30 bg-brand-soft text-brand-dark" : c.watched ? "border-destructive/20 bg-coral-soft text-destructive" : "bg-canvas",
                            )}
                            title={c.yours ? "Your product" : c.watched ? "A competitor you watch" : "Not watched"}
                          >
                            <a href={`https://www.${domain}/dp/${c.asin}`} target="_blank" rel="noopener noreferrer">
                              {i + 1}. {c.asin}
                            </a>{" "}
                            <span className="text-muted-foreground">
                              {percent(c.click, 0)} · {percent(c.conversion, 0)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </td>
                    <td className="text-right">
                      <ResearchActions term={r.term} products={data.products} competitorAsins={rivals} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data.rows.length && <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">No searches match.</p>}
      </Panel>
    </div>
  );
}
