import Link from "next/link";
import { formatValue } from "@/components/dashboard/format";
import { KpiCard, MetricChartCard } from "@/components/dashboard/MetricCards";
import { SectionHeader } from "@/components/PageHeader";
import { getDashboard } from "@/lib/dashboard";
import type { MarketplaceCode } from "@/lib/marketplaces";
import type { Period } from "@/lib/periods";
import { getProductTable } from "@/lib/products-table";
import { getSqpPerformance, type SqpQueryRow } from "@/lib/sqp";
import { cn } from "@/lib/utils";

// Product Overview, built on real data only: sales from orders, the listing's price, stock and rank, and how
// the product does in Amazon search (Search Query Performance). Keyword ranks live on the Keywords tab.

const share = (part: number, whole: number) => (whole ? part / whole : null);
const pct = (n: number | null) => {
  if (n == null) return "—";
  const p = n * 100;
  return p === 0 ? "0%" : `${p.toFixed(p < 0.1 ? 3 : p < 1 ? 2 : 1)}%`;
};
const int = (n: number) => n.toLocaleString();

export async function ProductOverview({ productId, asin, marketplace, period }: { productId: number; asin: string; marketplace: MarketplaceCode; period: Period }) {
  const [d, table, sqp] = await Promise.all([
    getDashboard(period, marketplace, asin),
    getProductTable(period, marketplace),
    getSqpPerformance(productId, { from: period.from, to: period.to }),
  ]);
  const s = d.sales;
  const a = d.ads;
  const row = table.rows.find((r) => r.id === productId);
  const money = (n: number | null | undefined) => (n == null ? "—" : formatValue("money", n, d.currency));

  type SalesPoint = (typeof s.series)[number];
  const salesPoints = (pick: (t: Pick<SalesPoint, "units" | "amount" | "orders" | "avgOrder">) => number | null) =>
    s.series.map((p) => ({ label: p.label, current: pick(p), previous: p.previous ? pick(p.previous) : null }));

  // At a glance: the listing today.
  const glance: { label: string; value: React.ReactNode; note?: string; tone?: "good" | "bad" }[] = row
    ? [
        {
          label: "Price",
          value: money(row.price),
          note: row.salePrice != null && row.regularPrice ? `Sale, regular ${money(row.regularPrice)} (−${Math.round((1 - row.salePrice / row.regularPrice) * 100)}%)` : undefined,
        },
        {
          label: "Buy Box",
          value: row.buyBox?.yours == null ? "—" : row.buyBox.yours ? "Yours" : "Not yours",
          note: row.buyBox?.price != null ? `Buy Box price ${money(row.buyBox.price)}` : undefined,
          tone: row.buyBox?.yours == null ? undefined : row.buyBox.yours ? "good" : "bad",
        },
        { label: "Best Sellers Rank", value: row.bsr ? `#${int(row.bsr.rank)}` : "—", note: row.bsr?.category },
        {
          label: "Available stock",
          value: row.inventory ? int(row.inventory.fulfillable) : "—",
          note: [row.inventory?.inbound ? `${int(row.inventory.inbound)} inbound` : null, row.daysOfCover != null ? `~${row.daysOfCover} days of cover` : null].filter(Boolean).join(" · ") || undefined,
          tone: row.daysOfCover != null && row.daysOfCover < 21 ? "bad" : undefined,
        },
        { label: "Landed cost", value: money(row.unitCost), note: row.costRef ? `From shipment ${row.costRef}` : undefined },
        {
          label: "Profit per unit",
          value: money(row.netPerUnit),
          note: row.fees.total != null ? `After ${money(row.fees.total)} Amazon fees${row.unitCost != null ? " and landed cost" : ""}` : undefined,
          tone: row.netPerUnit == null ? undefined : row.netPerUnit > 0 ? "good" : "bad",
        },
      ]
    : [];

  // Search: where shoppers see and buy the product, and where it's missing out.
  const t = sqp.totals;
  const top = sqp.rows.slice(0, 5);
  const ctr = t ? share(t.asinClicks, t.asinImpressions) : null;
  const opportunities: { row: SqpQueryRow; reason: string }[] = [];
  for (const r of sqp.rows) {
    if (opportunities.length >= 4) break;
    const rowCtr = share(r.asinClicks, r.asinImpressions);
    if (r.asinImpressions >= 50 && ctr != null && (rowCtr ?? 0) < ctr / 2) {
      opportunities.push({ row: r, reason: `Seen ${int(r.asinImpressions)} times, ${r.asinClicks ? `only ${r.asinClicks} click${r.asinClicks === 1 ? "" : "s"}` : "no clicks"}: check image, price and title for this search` });
    } else if (r.asinPurchases > 0 && !r.tracked && r.searches > 1000) {
      opportunities.push({ row: r, reason: `Already selling here (${r.asinPurchases} purchase${r.asinPurchases === 1 ? "" : "s"}): track its rank` });
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {s.hasData ? (
            <MetricChartCard
              title="Sales"
              currency={d.currency}
              compareLabel={period.compareLabel}
              previousLabel={period.previousLabel}
              measures={[
                { key: "units", label: "Units", kind: "number", current: s.current.units, previous: s.previous?.units, points: salesPoints((x) => x.units) },
                { key: "amount", label: "Revenue", kind: "money", current: s.current.amount, previous: s.previous?.amount, points: salesPoints((x) => x.amount) },
                { key: "orders", label: "Orders", kind: "number", current: s.current.orders, previous: s.previous?.orders, points: salesPoints((x) => x.orders) },
                { key: "avg", label: "Average order", kind: "money", current: s.current.avgOrder, previous: s.previous?.avgOrder, points: salesPoints((x) => x.avgOrder) },
              ]}
            />
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed bg-card text-[13px] text-muted-foreground">No orders yet.</div>
          )}
        </div>
        <section className="rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
          <h3 className="border-b px-5 py-3.5 text-[13px] font-medium text-muted-foreground">At a glance</h3>
          {glance.length ? (
            <dl className="divide-y">
              {glance.map((g) => (
                <div key={g.label} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                  <dt className="text-[13px] text-muted-foreground">{g.label}</dt>
                  <dd className="text-right">
                    <span className={cn("text-[13px] font-semibold tabular-nums", g.tone === "good" && "text-positive", g.tone === "bad" && "text-destructive")}>{g.value}</span>
                    {g.note && <span className="block text-[11px] text-muted-foreground">{g.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted-foreground">No listing details yet; they arrive with the next Amazon sync.</p>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <SectionHeader
          title="Where you stand in search"
          meta={
            sqp.covered ? (
              <>
                Amazon Search Query Performance · {sqp.covered.label} ·{" "}
                <Link href={`/products/${productId}?tab=queries`} className="font-medium text-brand hover:text-brand-dark">
                  All search queries
                </Link>
              </>
            ) : undefined
          }
        />
        {t ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="grid gap-4 sm:grid-cols-3 lg:col-span-3 xl:col-span-1 xl:grid-cols-1">
              {[
                { label: "Impression share", value: pct(share(t.asinImpressions, t.impressions)), note: `${int(t.asinImpressions)} of ${int(t.impressions)} impressions` },
                { label: "Click share", value: pct(share(t.asinClicks, t.clicks)), note: `${int(t.asinClicks)} clicks · ${pct(ctr)} of your impressions` },
                { label: "Purchase share", value: pct(share(t.asinPurchases, t.purchases)), note: `${int(t.asinPurchases)} purchases · ${pct(share(t.asinPurchases, t.asinClicks))} of your clicks` },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border bg-card px-4 py-3 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
                  <p className="text-[13px] font-medium text-muted-foreground">{c.label}</p>
                  <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.note}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)] lg:col-span-2">
              <h3 className="border-b px-4 py-3 text-[13px] font-semibold">Top searches showing your product</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-[13px]">
                  <thead className="bg-canvas text-xs text-muted-foreground">
                    <tr className="border-b [&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
                      <th className="text-left">Search query</th>
                      <th className="text-right">Searches</th>
                      <th className="text-right">Your impressions</th>
                      <th className="text-right">Click share</th>
                      <th className="text-right">Purchases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={r.query} className="border-b last:border-0 [&>td]:px-4 [&>td]:py-2">
                        <td className="max-w-[220px] truncate font-medium" title={r.query}>
                          {r.query}
                        </td>
                        <td className="text-right tabular-nums">{int(r.searches)}</td>
                        <td className="text-right tabular-nums">{int(r.asinImpressions)}</td>
                        <td className="text-right tabular-nums">{pct(share(r.asinClicks, r.clicks))}</td>
                        <td className="text-right tabular-nums">{int(r.asinPurchases)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {opportunities.length > 0 && (
              <div className="rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)] lg:col-span-3">
                <h3 className="border-b px-4 py-3 text-[13px] font-semibold">Opportunities</h3>
                <ul className="divide-y">
                  {opportunities.map((o) => (
                    <li key={o.row.query} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-[13px]">
                      <span className="font-medium">{o.row.query}</span>
                      <span className="text-muted-foreground">{o.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card px-5 py-6 text-[13px] text-muted-foreground">
            No Search Query Performance week covers these dates
            {sqp.latest ? `; the latest is ${sqp.latest.label}. Try a longer range.` : ". Amazon publishes it weekly for brand-registered products."}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Advertising"
          meta={
            a.demo ? (
              <>
                Sample data ·{" "}
                <Link href="/settings#ads-upload" className="font-medium text-brand hover:text-brand-dark">
                  Upload your ads reports
                </Link>
              </>
            ) : a.latestDay ? (
              `Sponsored Products · latest ${a.latestDay}`
            ) : undefined
          }
        />
        {a.hasData ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Ad spend" kind="money" current={a.current.spend} previous={a.previous?.spend} points={a.series.map((p) => (p.reported ? p.spend : null))} labels={a.series.map((p) => p.label)} currency={d.currency} better="neutral" />
            <KpiCard label="Ad sales" kind="money" current={a.current.sales} previous={a.previous?.sales} points={a.series.map((p) => (p.reported ? p.sales : null))} labels={a.series.map((p) => p.label)} currency={d.currency} />
            <KpiCard label="ACoS" kind="percent" current={a.current.acos} previous={a.previous?.acos} points={a.series.map((p) => (p.reported ? p.acos : null))} labels={a.series.map((p) => p.label)} currency={d.currency} better="down" hint="Ad spend ÷ ad sales" />
            <KpiCard label="Clicks" kind="number" current={a.current.clicks} previous={a.previous?.clicks} points={a.series.map((p) => (p.reported ? p.clicks : null))} labels={a.series.map((p) => p.label)} currency={d.currency} />
            <KpiCard
              label="TACoS"
              kind="percent"
              current={s.current.amount ? a.current.spend / s.current.amount : null}
              previous={a.previous && s.previous?.amount ? a.previous.spend / s.previous.amount : null}
              points={[]}
              currency={d.currency}
              better="down"
              hint="Ad spend ÷ all sales of this product"
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card px-5 py-6 text-[13px] text-muted-foreground">
            No ad data for this product yet. <Link href="/settings#ads-upload" className="font-medium text-brand hover:text-brand-dark">Upload your ads reports</Link>.
          </div>
        )}
      </section>
    </div>
  );
}
