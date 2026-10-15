import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { KpiCard, MetricChartCard } from "@/components/dashboard/MetricCards";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdsConfigured } from "@/lib/amazon/ads";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { dashboardMarketplaces, getDashboard } from "@/lib/dashboard";
import { isMarketplace, marketplaces, type MarketplaceCode } from "@/lib/marketplaces";
import { isPeriodKey, resolvePeriod } from "@/lib/periods";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage(props: PageProps<"/">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function DashboardContent({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  // Periods depend on the current time, so render per request.
  await connection();
  const key = one(sp.period);
  const period = resolvePeriod(isPeriodKey(key) ? key : "today", one(sp.from), one(sp.to));
  const available = await dashboardMarketplaces();
  const requested = one(sp.m);
  const marketplace: MarketplaceCode = requested && isMarketplace(requested) ? requested : (available[0] ?? "US");
  const d = await getDashboard(period, marketplace);
  const s = d.sales;
  const a = d.ads;

  type SalesPoint = (typeof s.series)[number];
  type AdPoint = (typeof a.series)[number];
  const salesPoints = (pick: (t: Pick<SalesPoint, "units" | "amount" | "orders" | "avgOrder">) => number | null) =>
    s.series.map((p) => ({ label: p.label, current: pick(p), previous: p.previous ? pick(p.previous) : null }));
  const adPoints = (pick: (t: Pick<AdPoint, "spend" | "sales" | "acos" | "clicks">) => number | null) =>
    a.series.map((p) => ({ label: p.label, current: p.reported ? pick(p) : null, previous: p.previous ? pick(p.previous) : null }));

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        description={`${marketplaces[marketplace].flag} ${marketplaces[marketplace].name}`}
        actions={
          <DashboardControls
            period={period.key}
            from={period.from}
            to={period.to}
            marketplace={marketplace}
            marketplaceOptions={(available.length ? available : [marketplace]).map((m) => ({ code: m, label: `${marketplaces[m].flag}  ${marketplaces[m].name}` }))}
          />
        }
      />

      <section className="space-y-4">
        <SectionHeader title="Sales" meta={s.demo ? "Sample data" : s.updatedAt ? `Orders updated ${s.updatedAt.slice(11, 16)}` : undefined} />
        {s.hasData ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <MetricChartCard
              title="Sales"
              currency={d.currency}
              compareLabel={period.compareLabel}
              previousLabel={period.previousLabel}
              measures={[
                { key: "units", label: "Units", kind: "number", current: s.current.units, previous: s.previous?.units, points: salesPoints((t) => t.units) },
                { key: "amount", label: "Total amount", kind: "money", current: s.current.amount, previous: s.previous?.amount, points: salesPoints((t) => t.amount) },
                { key: "avg", label: "Average order", kind: "money", current: s.current.avgOrder, previous: s.previous?.avgOrder, points: salesPoints((t) => t.avgOrder) },
              ]}
            />
            <MetricChartCard
              title="Orders"
              currency={d.currency}
              compareLabel={period.compareLabel}
              previousLabel={period.previousLabel}
              measures={[{ key: "orders", label: "Orders", kind: "number", current: s.current.orders, previous: s.previous?.orders, points: salesPoints((t) => t.orders) }]}
            />
          </div>
        ) : (
          <EmptyState>
            {isSpApiConfigured() ? (
              "No orders yet for this marketplace. Orders are pulled from Amazon every hour while SellerDoos is running."
            ) : (
              <>
                Connect Seller Central in{" "}
                <Link href="/settings#connect" className="font-medium text-primary hover:underline">
                  Settings
                </Link>{" "}
                to see your sales.
              </>
            )}
          </EmptyState>
        )}
      </section>

      <section className="space-y-4">
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
              `Sponsored Products · reported daily, latest ${a.latestDay}`
            ) : undefined
          }
        />
        {a.hasData ? (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
              <KpiCard label="Ad spend" kind="money" current={a.current.spend} previous={a.previous?.spend} points={a.series.map((p) => (p.reported ? p.spend : null))} currency={d.currency} better="neutral" />
              <KpiCard label="Purchases" kind="number" current={a.current.purchases} previous={a.previous?.purchases} points={a.series.map((p) => (p.reported ? p.purchases : null))} currency={d.currency} />
              <KpiCard label="Clicks" kind="number" current={a.current.clicks} previous={a.previous?.clicks} points={a.series.map((p) => (p.reported ? p.clicks : null))} currency={d.currency} />
              <KpiCard label="CPC" kind="money" current={a.current.cpc} previous={a.previous?.cpc} points={a.series.map((p) => (p.reported ? p.cpc : null))} currency={d.currency} better="down" hint="Cost per click" />
              <KpiCard label="Impressions" kind="number" current={a.current.impressions} previous={a.previous?.impressions} points={a.series.map((p) => (p.reported ? p.impressions : null))} currency={d.currency} />
            </div>
            {a.series.length > 1 && (
              <MetricChartCard
                title="Advertising trend"
                currency={d.currency}
                compareLabel={period.compareLabel}
                previousLabel={period.previousLabel}
                measures={[
                  { key: "spend", label: "Ad spend", kind: "money", current: a.current.spend, previous: a.previous?.spend, points: adPoints((t) => t.spend), better: "neutral" },
                  { key: "sales", label: "Ad sales", kind: "money", current: a.current.sales, previous: a.previous?.sales, points: adPoints((t) => t.sales) },
                  { key: "acos", label: "ACoS", kind: "percent", current: a.current.acos, previous: a.previous?.acos, points: adPoints((t) => t.acos), better: "down" },
                  { key: "clicks", label: "Clicks", kind: "number", current: a.current.clicks, previous: a.previous?.clicks, points: adPoints((t) => t.clicks) },
                ]}
              />
            )}
          </>
        ) : (
          <EmptyState>
            {isAdsConfigured() ? (
              "No ad data yet for this marketplace. Ad reports arrive a few minutes after syncing."
            ) : (
              <>
                Connect Amazon Ads in{" "}
                <Link href="/settings#connect" className="font-medium text-primary hover:underline">
                  Settings
                </Link>{" "}
                to see spend, purchases, clicks and CPC.
              </>
            )}
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed px-6 py-10 text-center text-[13px] text-muted-foreground">{children}</div>;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
