import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ResearchActions } from "@/components/product/CommerceForms";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { getResearch } from "@/lib/commerce";
import { marketplaces } from "@/lib/marketplaces";
import { percent } from "@/lib/metrics";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage(props: PageProps<"/research">) {
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Keyword research</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">What shoppers search</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Amazon&apos;s Top Search Terms report: how popular each search is (rank 1 = most searched) and the three products shoppers click most. Filtered to
          searches related to your keywords and competitors.
        </p>
      </div>
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
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
      <div className="card p-10 text-center text-sm text-muted-foreground">
        No search terms yet. They come from Brand Analytics (Brand Registry needed). Connect SP-API in{" "}
        <Link href="/settings" className="font-semibold text-brand">Settings</Link>, add a product, and sync.
      </div>
    );
  }
  const domain = marketplaces[data.marketplace].domain;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-3" action="">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder="Filter searches" className="field w-64 rounded-full pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="mine" value="1" defaultChecked={onlyMine} className="accent-[var(--color-brand)]" />
          Only where you&apos;re a top click
        </label>
        <button className="btn">Apply</button>
        <span className="ml-auto text-xs text-muted-foreground">
          {marketplaces[data.marketplace].flag} Week of {data.week} · {data.rows.length} searches{!isSpApiConfigured() && " · sample data"}
        </span>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs font-semibold text-muted-foreground">
            <tr>
              <th className="px-6 py-3">Search</th>
              <th className="px-3 py-3 text-right" title="Search frequency rank: 1 is Amazon's most searched term">Popularity rank</th>
              <th className="px-3 py-3 text-right">vs last week</th>
              <th className="px-3 py-3">Top clicked products (click share · conversion share)</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((r) => {
              const moved = r.prev_rank ? r.prev_rank - r.frequency_rank : null;
              const rivals = [...new Set(r.clicks.filter((c) => !c.yours && !c.watched).map((c) => c.asin))];
              return (
                <tr key={r.term} className="align-top hover:bg-canvas/60">
                  <td className="px-6 py-3">
                    <a href={`https://www.${domain}/s?k=${encodeURIComponent(r.term)}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-brand">
                      {r.term}
                    </a>
                    {r.tracked && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand">TRACKING</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums">#{r.frequency_rank.toLocaleString()}</td>
                  <td className={`px-3 py-3 text-right text-xs font-bold tabular-nums ${moved == null || Math.abs(moved) < 1 ? "text-muted-foreground" : moved > 0 ? "text-brand" : "text-coral"}`}>
                    {moved == null ? "new" : moved > 0 ? `▲ ${moved.toLocaleString()}` : moved < 0 ? `▼ ${(-moved).toLocaleString()}` : "–"}
                  </td>
                  <td className="px-3 py-3">
                    <ol className="flex flex-wrap gap-1.5">
                      {r.clicks.map((c, i) => (
                        <li
                          key={c.asin}
                          className={`rounded-lg px-2 py-1 font-mono text-[11px] ${c.yours ? "bg-brand text-white" : c.watched ? "bg-coral-soft text-[#b4402f]" : "bg-canvas"}`}
                          title={c.yours ? "Your product" : c.watched ? "A competitor you watch" : "Not watched"}
                        >
                          <a href={`https://www.${domain}/dp/${c.asin}`} target="_blank" rel="noopener noreferrer">
                            {i + 1}. {c.asin}
                          </a>{" "}
                          <span className="opacity-70">
                            {percent(c.click, 0)} · {percent(c.conversion, 0)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </td>
                  <td className="px-6 py-3">
                    <ResearchActions term={r.term} products={data.products} competitorAsins={rivals} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.rows.length && <p className="p-8 text-center text-sm text-muted-foreground">No searches match.</p>}
      </div>
    </div>
  );
}
