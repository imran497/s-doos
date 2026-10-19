import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LineChart } from "@/components/charts";
import { ProductThumb } from "@/components/ProductThumb";
import { SyncAmazonButton } from "@/components/SettingsControls";
import { StatTile } from "@/components/StatTile";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { getBusiness } from "@/lib/commerce";
import { isPeriodKey, resolvePeriod } from "@/lib/periods";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { connection } from "next/server";
import { formatMoney, percent } from "@/lib/metrics";

export const metadata: Metadata = { title: "Business" };

export default function BusinessPage(props: PageProps<"/business">) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Business</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Sales, profit &amp; stock</h1>
          <p className="mt-1 text-muted-foreground">Across all your products, from Amazon&apos;s Sales &amp; Traffic report, Finances, Orders and FBA Inventory.</p>
        </div>
        <SyncAmazonButton />
      </div>
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <BusinessContent {...props} />
      </Suspense>
    </div>
  );
}

async function BusinessContent({ searchParams }: PageProps<"/business">) {
  const sp = await searchParams;
  // Periods depend on the current time, so render per request.
  await connection();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const key = one(sp.period);
  const period = resolvePeriod(isPeriodKey(key) ? key : "last_30", one(sp.from), one(sp.to));
  const b = await getBusiness({ from: period.from, to: period.to });
  const c = b.totals.currency;

  const connected = isSpApiConfigured();
  if (!b.hasData) {
    return (
      <div className="card p-10 text-center text-sm text-muted-foreground">
        {connected ? (
          <>
            Connected to Seller Central. Click <b>Sync Amazon data</b> above.
            {b.pendingReports > 0 && ` Amazon is building ${b.pendingReports} report(s); the first numbers usually appear within an hour or two.`} Progress is
            in <Link href="/settings" className="font-semibold text-brand">Settings → report queue</Link>.
          </>
        ) : (
          <>
            Nothing here yet. Connect Seller Central in <Link href="/settings" className="font-semibold text-brand">Settings</Link>, then sync.
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <DashboardControls period={period.key} from={period.from} to={period.to} marketplace="US" marketplaceOptions={[]} />
        {b.live ? (
          <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand-dark">
            ● Live from Amazon{b.lastSync ? ` · synced ${b.lastSync.slice(5, 16)}` : ""}
            {b.pendingReports > 0 ? ` · ${b.pendingReports} report(s) still coming` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-[#fdf1dc] px-3 py-1 text-xs font-bold text-[#8a5a12]">Sample data</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Revenue" value={formatMoney(b.totals.revenue, c)} hint="From your orders (US dollars), after promotions" />
        <StatTile label="Units" value={b.totals.units.toLocaleString()} hint="From your orders, cancelled ones left out" />
        <StatTile
          label="Conversion"
          value={percent(b.totals.conversion)}
          hint={`Units ÷ sessions on the ${b.totals.trafficDays} of ${b.dates.length} days Amazon's Sales & Traffic report covers`}
        />
        <StatTile label="Net profit" value={formatMoney(b.totals.profit, c)} hint="After Amazon fees, refunds, ads and cost of goods" />
      </div>

      <section id="revenue" className="scroll-mt-20 card p-6">
        <p className="eyebrow">Revenue per day</p>
        <div className="mt-4">
          <LineChart points={b.dates.map((d, i) => ({ label: d, value: b.series[i] }))} format={(v) => formatMoney(v, c, true)} />
        </div>
      </section>

      <section id="profit" className="scroll-mt-20 card overflow-x-auto">
        <p className="eyebrow px-6 pt-6">Profit by product</p>
        <table className="mt-4 w-full text-sm">
          <thead className="border-y border-line text-right text-xs font-semibold text-muted-foreground">
            <tr>
              <th className="px-6 py-3 text-left">Product</th>
              <th className="px-3 py-3">Sales</th>
              <th className="px-3 py-3">Amazon fees</th>
              <th className="px-3 py-3">Refunds</th>
              <th className="px-3 py-3">Ad spend</th>
              <th className="px-3 py-3">Cost of goods</th>
              <th className="px-3 py-3">Profit</th>
              <th className="px-6 py-3">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-right tabular-nums">
            {b.perProduct.map((p) => (
              <tr key={p.id} className="hover:bg-canvas/60">
                <td className="px-6 py-3 text-left">
                  <Link href={`/products/${p.id}?tab=sales`} className="flex items-center gap-3 hover:text-brand">
                    <ProductThumb src={p.image_url} size={36} />
                    <span className="line-clamp-1 max-w-64 font-semibold">{p.title ?? p.asin}</span>
                  </Link>
                </td>
                <td className="px-3 py-3">{formatMoney(p.profit.sales, c)}</td>
                <td className="px-3 py-3 text-coral">{formatMoney(p.profit.amazonFees, c)}</td>
                <td className="px-3 py-3 text-coral">{formatMoney(p.profit.refunds, c)}</td>
                <td className="px-3 py-3 text-coral">{formatMoney(-p.profit.adSpend, c)}</td>
                <td className="px-3 py-3">
                  {p.profit.cogs == null ? (
                    <Link href={`/products/${p.id}?tab=sales`} className="text-xs font-semibold text-brand">
                      add cost
                    </Link>
                  ) : (
                    <span className="text-coral">{formatMoney(-p.profit.cogs, c)}</span>
                  )}
                </td>
                <td className={`px-3 py-3 font-extrabold ${p.profit.profit < 0 ? "text-coral" : ""}`}>{formatMoney(p.profit.profit, c)}</td>
                <td className="px-6 py-3 text-muted-foreground">{percent(p.profit.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section id="inventory" className="scroll-mt-20 card overflow-x-auto">
          <div className="px-6 pt-6">
            <p className="eyebrow">FBA inventory</p>
            <p className="mt-1 text-xs text-muted-foreground">Days of cover at the last 14 days&apos; sales pace. Under {b.lowStockDays} days is flagged.</p>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead className="border-y border-line text-right text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left">SKU</th>
                <th className="px-3 py-3">Available</th>
                <th className="px-3 py-3">Inbound</th>
                <th className="px-3 py-3">Reserved</th>
                <th className="px-6 py-3">Days left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-right tabular-nums">
              {b.inventory.map((i) => (
                <tr key={`${i.marketplace}-${i.sku}`} className={i.low ? "bg-coral-soft/50" : ""}>
                  <td className="px-6 py-3 text-left">
                    <span className="font-mono text-xs font-semibold">{i.sku}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{i.asin}</span>
                  </td>
                  <td className="px-3 py-3 font-bold">{i.fulfillable.toLocaleString()}</td>
                  <td className="px-3 py-3 text-muted-foreground">{i.inbound.toLocaleString()}</td>
                  <td className="px-3 py-3 text-muted-foreground">{i.reserved.toLocaleString()}</td>
                  <td className={`px-6 py-3 font-bold ${i.low ? "text-coral" : ""}`}>{i.daysOfCover == null ? "–" : `${i.daysOfCover}${i.low ? " · low" : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!b.inventory.length && <p className="p-6 text-center text-sm text-muted-foreground">No FBA inventory found.</p>}
        </section>

        <section id="orders" className="scroll-mt-20 card overflow-x-auto">
          <p className="eyebrow px-6 pt-6">Recent orders</p>
          <table className="mt-4 w-full text-sm">
            <thead className="border-y border-line text-right text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left">Order</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3">Qty</th>
                <th className="px-6 py-3">Item price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-right tabular-nums">
              {b.orders.map((o) => (
                <tr key={`${o.order_id}-${o.sku}`}>
                  <td className="px-6 py-2.5 text-left">
                    <span className="font-mono text-xs">{o.order_id}</span>
                    <span className="block text-[11px] text-muted-foreground">{o.purchase_date.slice(0, 16).replace("T", " ")}</span>
                  </td>
                  <td className="px-3 py-2.5 text-left">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        o.status === "Shipped" ? "bg-brand-soft text-brand" : o.status === "Cancelled" ? "bg-coral-soft text-coral" : "bg-canvas text-muted-foreground"
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{o.qty}</td>
                  <td className="px-6 py-2.5">{formatMoney(o.item_price, o.currency || c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!b.orders.length && <p className="p-6 text-center text-sm text-muted-foreground">No orders yet.</p>}
        </section>
      </div>
      {!isSpApiConfigured() && <p className="text-xs text-muted-foreground">Sample data. Connect SP-API in Settings to see your real business.</p>}
    </div>
  );
}
