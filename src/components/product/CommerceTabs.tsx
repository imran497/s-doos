import Link from "next/link";
import { OrdersList } from "@/components/product/OrdersList";
import type { ProductOrder } from "@/lib/product-orders";
import { MultiLineChart, Sparkline } from "@/components/charts";
import { ProductThumb } from "@/components/ProductThumb";
import { StatTile } from "@/components/StatTile";
import { AddCompetitorForm, RemoveCompetitorButton, UnitCostForm } from "@/components/product/CommerceForms";
import { TrackButton } from "@/components/product/SmallActions";
import type { getAdsDetail, getCompetitorDetail, getSalesDetail } from "@/lib/commerce";
import { compact, formatMoney, percent, signedPercent } from "@/lib/metrics";

type Sales = NonNullable<Awaited<ReturnType<typeof getSalesDetail>>>;
type Ads = NonNullable<Awaited<ReturnType<typeof getAdsDetail>>>;
type Competitors = NonNullable<Awaited<ReturnType<typeof getCompetitorDetail>>>;

const label = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

// ---- Sales & profit ----

export function SalesTab({ productId, sales, demo, orders }: { productId: number; sales: Sales; demo: boolean; orders: ProductOrder[] }) {
  if (!sales.hasData) {
    return (
      <div className="space-y-5">
        <Empty>
        {demo ? (
          <>
            No sales data yet. It comes from Amazon&apos;s Sales &amp; Traffic report (Brand Analytics role). Connect Seller Central in{" "}
            <Link href="/settings" className="font-semibold text-brand">Settings</Link>, then click “Sync Amazon data”.
          </>
        ) : (
          <>
            Connected. Amazon builds the daily Sales &amp; Traffic reports in the background (about 3 every 5 minutes), so the last 30 days fill in over
            an hour or two. Progress: <Link href="/settings" className="font-semibold text-brand">Settings → report queue</Link>.
          </>
        )}
      </Empty>
      <OrdersList orders={orders} />
      </div>
    );
  }
  const c = sales.currency;
  const p = sales.profit;
  const lines: { label: string; value: number | null; hint?: string; strong?: boolean }[] = [
    { label: "Sales", value: p.sales },
    { label: "Promotions", value: p.promotions },
    { label: "Amazon fees", value: p.amazonFees, hint: "Referral, FBA fulfilment and storage fees" },
    { label: "Refunds", value: p.refunds },
    { label: "Adjustments", value: p.adjustments, hint: "Reimbursements and other corrections" },
    { label: "Ad spend", value: p.adSpend ? -p.adSpend : 0 },
    { label: `Cost of goods (${p.units} units)`, value: p.cogs == null ? null : -p.cogs },
    { label: "Net profit", value: p.profit, strong: true },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Revenue" value={formatMoney(sales.totals.revenue, c)} change={sales.change.revenue} />
        <StatTile label="Units ordered" value={sales.totals.units.toLocaleString()} change={sales.change.units} />
        <StatTile label="Sessions" value={sales.totals.sessions.toLocaleString()} change={sales.change.sessions} />
        <StatTile label="Conversion" value={percent(sales.totals.conversion)} hint="Units ordered ÷ sessions" />
        <StatTile label="Net profit" value={formatMoney(p.profit, c)} hint="After Amazon fees, refunds, ads and your cost of goods" />
      </div>

      <OrdersList orders={orders} />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-6">
          <p className="eyebrow">Where the money went</p>
          <p className="mt-1 text-xs text-muted-foreground">From what Amazon posted to your account in this period (Finances API).</p>
          <dl className="mt-4 divide-y divide-line text-sm">
            {lines.map((l) => (
              <div key={l.label} className={`flex items-center justify-between py-2.5 ${l.strong ? "text-base font-extrabold" : ""}`} title={l.hint}>
                <dt className={l.strong ? "" : "text-muted-foreground"}>{l.label}</dt>
                <dd className={`tabular-nums ${l.value != null && l.value < 0 ? "text-coral" : ""}`}>
                  {l.value == null ? <span className="text-xs text-muted-foreground">add your unit cost →</span> : formatMoney(l.value, c)}
                </dd>
              </div>
            ))}
          </dl>
          {p.margin != null && <p className="mt-2 text-right text-xs font-semibold text-muted-foreground">Margin {percent(p.margin)}</p>}
        </section>

        <div className="space-y-5">
          <section className="card space-y-3 p-6">
            <p className="eyebrow">Cost of goods</p>
            {sales.shipmentCost ? (
              <>
                <p className="text-2xl font-semibold tabular-nums">{formatMoney(sales.shipmentCost.unitCost, "USD")}</p>
                <p className="text-xs text-muted-foreground">
                  Per unit, from shipment {sales.shipmentCost.ref} (first-in, first-out).{" "}
                  <Link href="/shipments" className="font-medium text-brand hover:text-brand-dark">
                    Shipments
                  </Link>
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  What one unit costs you to make and ship to Amazon. Used for profit. Adding a{" "}
                  <Link href="/shipments" className="font-medium text-brand hover:text-brand-dark">
                    shipment
                  </Link>{" "}
                  works it out for you.
                </p>
                <UnitCostForm productId={productId} unitCost={sales.unitCost} currency={c} />
              </>
            )}
          </section>
          <section className={`card p-6 ${sales.stock?.low ? "ring-2 ring-coral/40" : ""}`}>
            <p className="eyebrow">FBA stock</p>
            {sales.stock ? (
              <>
                <p className="mt-2 text-3xl font-extrabold tabular-nums">{sales.stock.fulfillable.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">
                  units available
                  {sales.stock.daysOfCover != null && (
                    <>
                      {" "}· <span className={sales.stock.low ? "font-bold text-coral" : "font-semibold text-ink"}>~{sales.stock.daysOfCover} days</span> at{" "}
                      {sales.stock.dailyUnits.toFixed(1)}/day
                    </>
                  )}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {sales.stock.inbound.toLocaleString()} inbound · {sales.stock.reserved.toLocaleString()} reserved · as of {sales.stock.asOf}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No FBA inventory found for this ASIN.</p>
            )}
          </section>
        </div>
      </div>
      {demo && <p className="text-xs text-muted-foreground">Sample data. Connect SP-API in Settings to see your real numbers.</p>}
    </div>
  );
}

// ---- Ads ----

export function AdsTab({ productId, ads, currency, demo }: { productId: number; ads: Ads; currency: string; demo: boolean }) {
  if (!ads.hasData) {
    return (
      <Empty>
        No ad data yet. It comes from the Amazon Ads API (Sponsored Products). Connect it in{" "}
        <Link href="/settings" className="font-semibold text-brand">Settings</Link>.
      </Empty>
    );
  }
  const t = ads.totals;
  const converting = ads.terms.filter((x) => x.purchases > 0 && !x.tracked).slice(0, 5);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Ad spend" value={formatMoney(t.cost, currency)} />
        <StatTile label="Ad sales" value={formatMoney(t.sales, currency)} />
        <StatTile label="ACoS" value={percent(ads.acos)} hint="Ad spend ÷ ad sales" />
        <StatTile label="TACoS" value={percent(ads.tacos)} hint="Ad spend ÷ all sales (organic + ads)" />
        <StatTile label="Clicks" value={t.clicks.toLocaleString()} hint={`${t.impressions.toLocaleString()} impressions`} />
      </div>

      <section className="card p-6">
        <p className="eyebrow">Spend vs ad sales</p>
        <div className="mt-4">
          <MultiLineChart
            labels={ads.dates}
            series={[
              { name: "Ad sales", values: ads.series.map((s) => s.sales), highlight: true },
              { name: "Spend", values: ads.series.map((s) => s.cost) },
            ]}
            format={(v) => formatMoney(v, currency, true)}
          />
        </div>
      </section>

      {converting.length > 0 && (
        <section className="card bg-gradient-to-br from-white to-brand-soft/60 p-6">
          <p className="eyebrow">Converting in ads, not tracked organically</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {converting.map((x) => (
              <li key={x.search_term} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{x.search_term}</span>
                  <span className="text-xs text-muted-foreground">
                    {x.purchases} orders · {percent(x.acos, 0)} ACoS
                  </span>
                </span>
                <TrackButton productId={productId} keyword={x.search_term} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-x-auto">
        <div className="px-6 pt-6">
          <p className="eyebrow">Customer search terms</p>
          <p className="mt-1 text-xs text-muted-foreground">What shoppers typed before clicking your Sponsored Products ads (7-day attribution).</p>
        </div>
        <table className="mt-4 w-full text-sm">
          <thead className="border-y border-line text-right text-xs font-semibold text-muted-foreground">
            <tr>
              <th className="px-6 py-3 text-left">Search term</th>
              <th className="px-3 py-3">Impr.</th>
              <th className="px-3 py-3">Clicks</th>
              <th className="px-3 py-3">Spend</th>
              <th className="px-3 py-3">Orders</th>
              <th className="px-3 py-3">Sales</th>
              <th className="px-3 py-3">ACoS</th>
              <th className="px-3 py-3" title="Share of top-of-search impressions you won">Top of search</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-right tabular-nums">
            {ads.terms.slice(0, 60).map((x) => (
              <tr key={x.search_term} className="hover:bg-canvas/60">
                <td className="px-6 py-2.5 text-left font-semibold">{x.search_term}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{compact(x.impressions)}</td>
                <td className="px-3 py-2.5">{x.clicks}</td>
                <td className="px-3 py-2.5">{formatMoney(x.cost, currency)}</td>
                <td className="px-3 py-2.5">{x.purchases}</td>
                <td className="px-3 py-2.5">{formatMoney(x.sales, currency)}</td>
                <td className={`px-3 py-2.5 font-bold ${x.acos == null ? "text-coral" : x.acos <= 0.3 ? "text-brand" : x.acos > 0.6 ? "text-coral" : ""}`}>
                  {x.acos == null ? "no sales" : percent(x.acos, 0)}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{x.top_share == null ? "–" : `${Math.round(x.top_share)}%`}</td>
                <td className="px-6 py-2.5">{x.tracked ? <span className="text-xs font-semibold text-brand">Tracking</span> : <TrackButton productId={productId} keyword={x.search_term} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {demo && <p className="text-xs text-muted-foreground">Sample data. Connect the Amazon Ads API in Settings to see your campaigns.</p>}
    </div>
  );
}

// ---- Competitors ----

export function CompetitorsTab({ productId, data, demo }: { productId: number; data: Competitors; demo: boolean }) {
  const rows = [{ ...data.own, id: 0, brand: "You", you: true }, ...data.rivals.map((r) => ({ ...r, you: false }))];
  const currency = rows.find((r) => r.latest?.currency)?.latest?.currency || "USD";
  return (
    <div className="space-y-5">
      <section className="card p-6">
        <AddCompetitorForm productId={productId} />
        <p className="mt-2 text-xs text-muted-foreground">Daily BSR from the Catalog API and Buy Box, lowest price and seller count from the Pricing API. Find rivals in Research (top clicked ASINs).</p>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Best Sellers Rank</p>
        <div className="mt-4">
          <MultiLineChart
            invert
            labels={data.dates.map(label)}
            format={(v) => `#${compact(v)}`}
            series={rows.map((r) => ({ name: r.you ? "You" : (r.brand ?? r.title ?? r.asin).slice(0, 24), values: r.bsrSeries, highlight: r.you }))}
          />
        </div>
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-right text-xs font-semibold text-muted-foreground">
            <tr>
              <th className="px-6 py-3 text-left">Product</th>
              <th className="px-3 py-3">BSR</th>
              <th className="px-3 py-3 text-left">BSR trend</th>
              <th className="px-3 py-3">Buy Box</th>
              <th className="px-3 py-3">7-day price change</th>
              <th className="px-3 py-3">Lowest</th>
              <th className="px-3 py-3">Sellers</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-right tabular-nums">
            {rows.map((r) => {
              const bsrDelta = (() => {
                const v = r.bsrSeries.filter((x): x is number => x != null);
                return v.length > 1 ? v[0] - v[v.length - 1] : null;
              })();
              const priceChange = signedPercent(r.priceChange);
              return (
                <tr key={r.asin} className={r.you ? "bg-brand-soft/40" : "hover:bg-canvas/60"}>
                  <td className="px-6 py-3 text-left">
                    <div className="flex items-center gap-3">
                      <ProductThumb src={r.image_url} size={40} />
                      <div className="min-w-0">
                        <p className="line-clamp-1 max-w-72 font-semibold">{r.you ? "Your product" : (r.title ?? "Title appears after the next sync")}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {r.asin}
                          {!r.you && r.brand ? ` · ${r.brand}` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-bold">{r.latest?.bsr ? `#${r.latest.bsr.toLocaleString()}` : "–"}</td>
                  <td className="px-3 py-3">
                    <Sparkline series={r.bsrSeries} delta={bsrDelta} />
                  </td>
                  <td className="px-3 py-3 font-semibold">
                    {formatMoney(r.latest?.buy_box_price, currency)}
                    {r.you && r.latest?.you_have_buy_box === 0 && <span className="ml-1 rounded-full bg-coral-soft px-1.5 text-[10px] font-bold text-coral">LOST</span>}
                  </td>
                  <td className={`px-3 py-3 font-bold ${r.priceChange == null || r.priceChange === 0 ? "text-muted-foreground" : r.priceChange < 0 ? "text-coral" : "text-brand"}`}>
                    {priceChange ?? "–"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{formatMoney(r.latest?.lowest_price, currency)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{r.latest?.offer_count ?? "–"}</td>
                  <td className="px-4 py-3">{!r.you && <RemoveCompetitorButton competitorId={r.id} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.rivals.length && <p className="p-6 text-center text-sm text-muted-foreground">Add competitor ASINs above to compare BSR and prices.</p>}
      </section>
      {demo && <p className="text-xs text-muted-foreground">Sample data. Connect SP-API in Settings to see live BSR and prices.</p>}
    </div>
  );
}
