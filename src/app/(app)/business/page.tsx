import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { PageHeader } from "@/components/PageHeader";
import { Panel, tableStyles } from "@/components/Panel";
import { ProductThumb } from "@/components/ProductThumb";
import { SyncAmazonButton } from "@/components/SettingsControls";
import { StatTile } from "@/components/StatTile";
import { Skeleton } from "@/components/ui/skeleton";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { getBusiness } from "@/lib/commerce";
import { formatMoney, percent } from "@/lib/metrics";
import { isPeriodKey, resolvePeriod } from "@/lib/periods";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Business" };

export default function BusinessPage(props: PageProps<"/business">) {
  return (
    <Suspense fallback={<BusinessSkeleton />}>
      <BusinessContent {...props} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const orderTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: APP_TIME_ZONE });

async function BusinessContent({ searchParams }: PageProps<"/business">) {
  const sp = await searchParams;
  // Periods depend on the current time, so render per request.
  await connection();
  const key = one(sp.period);
  const period = resolvePeriod(isPeriodKey(key) ? key : "last_30", one(sp.from), one(sp.to));
  const b = await getBusiness({ from: period.from, to: period.to });
  const c = b.totals.currency;
  const connected = isSpApiConfigured();

  const description = b.live ? (
    <>
      Sales, profit and stock across all your products · <span className="text-positive">● Live from Amazon</span>
      {b.lastSync ? ` · synced ${b.lastSync.slice(5, 16)}` : ""}
      {b.pendingReports > 0 ? ` · ${b.pendingReports} report(s) still coming` : ""}
    </>
  ) : (
    <>
      Sales, profit and stock across all your products · <span className="font-medium text-[#8a5a12]">Sample data</span>
    </>
  );

  const header = (
    <PageHeader
      title="Business"
      description={description}
      actions={
        <>
          <SyncAmazonButton />
          <DashboardControls period={period.key} from={period.from} to={period.to} marketplace="US" marketplaceOptions={[]} />
        </>
      }
    />
  );

  if (!b.hasData) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center text-[13px] text-muted-foreground">
          {connected ? (
            <>
              Connected to Seller Central. Click <b>Sync Amazon data</b> above.
              {b.pendingReports > 0 && ` Amazon is building ${b.pendingReports} report(s); the first numbers usually appear within an hour or two.`} Progress is
              in{" "}
              <Link href="/settings#runs" className="font-medium text-brand">
                Settings → report queue
              </Link>
              .
            </>
          ) : (
            <>
              Nothing here yet. Connect Seller Central in{" "}
              <Link href="/settings#connect" className="font-medium text-brand">
                Settings
              </Link>
              , then sync.
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Revenue" value={formatMoney(b.totals.revenue, c)} hint="From your orders (US dollars), after promotions" />
        <StatTile label="Units" value={b.totals.units.toLocaleString()} hint="From your orders, cancelled ones left out" />
        <StatTile
          label="Conversion"
          value={percent(b.totals.conversion)}
          hint={`Units ÷ sessions on the ${b.totals.trafficDays} of ${b.dates.length} days Amazon's Sales & Traffic report covers`}
        />
        <StatTile label="Net profit" value={formatMoney(b.totals.profit, c)} hint="After Amazon fees, refunds, real ad spend and cost of goods" />
      </div>

      <Panel id="revenue" title="Revenue per day" meta="From your orders; hover a day for the amount">
        <TrendChart data={b.dates.map((d, i) => ({ label: dayLabel(d), current: b.series[i], previous: null }))} kind="money" currency={c} />
      </Panel>

      <Panel id="profit" title="Profit by product" meta="From what Amazon posted to your account in these days" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={cn(tableStyles.table, "min-w-[860px]")}>
            <thead className={tableStyles.head}>
              <tr className="border-b text-right">
                <th className="text-left">Product</th>
                <th>Sales</th>
                <th>Amazon fees</th>
                <th>Refunds</th>
                <th>Ad spend</th>
                <th>Cost of goods</th>
                <th>Profit</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody className="text-right tabular-nums">
              {b.perProduct.map((p) => (
                <tr key={p.id} className={cn(tableStyles.row, "hover:bg-canvas/50")}>
                  <td className="text-left">
                    <Link href={`/products/${p.id}?tab=sales`} className="flex items-center gap-2.5 hover:text-brand">
                      <ProductThumb src={p.image_url} size={28} />
                      <span className="line-clamp-1 max-w-64 font-medium">{p.title ?? p.asin}</span>
                    </Link>
                  </td>
                  <td>{formatMoney(p.profit.sales, c)}</td>
                  <td className="text-muted-foreground">{formatMoney(p.profit.amazonFees, c)}</td>
                  <td className="text-muted-foreground">{formatMoney(p.profit.refunds, c)}</td>
                  <td className="text-muted-foreground">{formatMoney(-p.profit.adSpend, c)}</td>
                  <td>
                    {p.profit.cogs == null ? (
                      <Link href="/shipments" className="text-xs font-medium text-brand">
                        add a shipment
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{formatMoney(-p.profit.cogs, c)}</span>
                    )}
                  </td>
                  <td className={cn("font-semibold", p.profit.profit < 0 ? "text-destructive" : "text-positive")}>{formatMoney(p.profit.profit, c)}</td>
                  <td className="text-muted-foreground">{percent(p.profit.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="inventory" title="FBA inventory" meta={`Days of cover at the last 14 days' sales pace; under ${b.lowStockDays} days is flagged${b.emptySkus ? ` · ${b.emptySkus} SKUs with no stock hidden` : ""}`} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className={tableStyles.table}>
              <thead className={tableStyles.head}>
                <tr className="border-b text-right">
                  <th className="text-left">SKU</th>
                  <th>Available</th>
                  <th>Inbound</th>
                  <th>Reserved</th>
                  <th>Days left</th>
                </tr>
              </thead>
              <tbody className="text-right tabular-nums">
                {b.inventory.map((i) => (
                  <tr key={`${i.marketplace}-${i.sku}`} className={tableStyles.row}>
                    <td className="text-left">
                      <span className="font-mono text-xs">{i.sku}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{i.asin}</span>
                    </td>
                    <td className="font-medium">{i.fulfillable.toLocaleString()}</td>
                    <td className="text-muted-foreground">{i.inbound.toLocaleString()}</td>
                    <td className="text-muted-foreground">{i.reserved.toLocaleString()}</td>
                    <td>
                      {i.daysOfCover == null ? (
                        "—"
                      ) : i.low ? (
                        <span className="rounded bg-coral-soft px-1.5 py-0.5 text-xs font-medium text-destructive">{i.daysOfCover} · low</span>
                      ) : (
                        i.daysOfCover
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!b.inventory.length && <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">No FBA stock found.</p>}
        </Panel>

        <Panel id="orders" title="Recent orders" meta="Times in Central Time" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className={tableStyles.table}>
              <thead className={tableStyles.head}>
                <tr className="border-b text-right">
                  <th className="text-left">Order</th>
                  <th className="text-left">Status</th>
                  <th>Qty</th>
                  <th>Item price</th>
                </tr>
              </thead>
              <tbody className="text-right tabular-nums">
                {b.orders.map((o) => (
                  <tr key={`${o.order_id}-${o.sku}`} className={tableStyles.row}>
                    <td className="text-left">
                      <span className="font-mono text-xs">{o.order_id}</span>
                      <span className="block text-[11px] text-muted-foreground">{orderTime(o.purchase_date)}</span>
                    </td>
                    <td className="text-left">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px] font-medium",
                          o.status === "Shipped" ? "bg-positive-soft text-positive" : o.status === "Cancelled" ? "bg-[#f1f3f7] text-[#545969]" : "bg-[#fdf1dc] text-[#8a5a12]",
                        )}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td>{o.qty}</td>
                    <td>{formatMoney(o.item_price, o.currency || c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!b.orders.length && <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">No orders yet.</p>}
        </Panel>
      </div>
    </div>
  );
}

function BusinessSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[84px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
