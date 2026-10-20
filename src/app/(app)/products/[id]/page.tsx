import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, LayoutGrid, List, Search } from "lucide-react";
import { DataSourceBanner } from "@/components/DataSourceBanner";
import { ProductThumb } from "@/components/ProductThumb";
import { AddKeywordsButton } from "@/components/product/AddKeywordsButton";
import { CheckNowButton } from "@/components/product/CheckNowButton";
import { KeywordTable } from "@/components/product/KeywordTable";
import { AdsTab, CompetitorsTab, SalesTab } from "@/components/product/CommerceTabs";
import { MoversAndOpportunities, Standing } from "@/components/product/Overview";
import { DeleteProductButton } from "@/components/product/SmallActions";
import { keywordTrends } from "@/lib/insights";
import { marketplaces } from "@/lib/marketplaces";
import { getProductDetail, getSqpQueries, type ProductDetail } from "@/lib/queries";
import { getSqpPerformance } from "@/lib/sqp";
import { getProductOrders } from "@/lib/product-orders";
import { getSerpProvider } from "@/lib/serp";
import { Segmented } from "@/components/Segmented";
import { Input } from "@/components/ui/input";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { ProductOverview } from "@/components/product/ProductOverview";
import { SectionHeader } from "@/components/PageHeader";
import { isPeriodKey, resolvePeriod } from "@/lib/periods";
import { connection } from "next/server";
import { SqpTab } from "@/components/product/SqpTab";
import { isAdsConfigured } from "@/lib/amazon/ads";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { getAdsDetail, getCompetitorDetail, getKeywordAds, getSalesDetail } from "@/lib/commerce";

export const metadata: Metadata = { title: "Product" };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "queries", label: "Search Query Performance" },
  { id: "keywords", label: "Keywords" },
  { id: "sales", label: "Sales & profit" },
  { id: "ads", label: "Ads" },
  { id: "competitors", label: "Competitors" },
] as const;

/** The Keywords tab shows 7/14/30 days of rank history. */
const RANGED = new Set(["keywords"]);
/** Tabs with the standard date picker (period / from / to in the URL). */
const DATED = new Set(["overview", "queries", "sales", "ads", "competitors"]);

type Query = {
  tab: (typeof TABS)[number]["id"];
  range: number;
  mode: "organic" | "sponsored";
  view: "list" | "grid";
  q: string;
  /** Search Query Performance date range (same picker as the Dashboard). */
  period: string;
  from: string;
  to: string;
};

export default function ProductPage(props: PageProps<"/products/[id]">) {
  return (
    <Suspense fallback={<div className="card h-72 animate-pulse" />}>
      <ProductView {...props} />
    </Suspense>
  );
}

async function ProductView({ params, searchParams }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const query: Query = {
    tab: TABS.some((t) => t.id === one(sp.tab)) ? (one(sp.tab) as Query["tab"]) : "overview",
    range: [7, 14, 30].includes(Number(one(sp.range))) ? Number(one(sp.range)) : 14,
    mode: one(sp.mode) === "sponsored" ? "sponsored" : "organic",
    view: one(sp.view) === "grid" ? "grid" : "list",
    q: one(sp.q).trim().toLowerCase(),
    period: one(sp.period),
    from: one(sp.from),
    to: one(sp.to),
  };

  const detail = await getProductDetail(Number(id), query.range);
  if (!detail) notFound();
  const { product } = detail;
  const market = marketplaces[product.marketplace];
  const sqpQueries = await getSqpQueries(product.id);

  const href = (change: Partial<Query>) => {
    const next = { ...query, ...change };
    const params = new URLSearchParams({ tab: next.tab });
    if (RANGED.has(next.tab)) params.set("range", String(next.range));
    if (next.tab === "keywords") {
      params.set("mode", next.mode);
      params.set("view", next.view);
      if (next.q) params.set("q", next.q);
    }
    if (DATED.has(next.tab) && next.period) {
      params.set("period", next.period);
      if (next.period === "custom") {
        params.set("from", next.from);
        params.set("to", next.to);
      }
    }
    return `/products/${product.id}?${params}`;
  };

  const latestBsr = detail.bsr.at(-1);

  return (
    <div className="space-y-6">
      <Link href="/products" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Products
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <ProductThumb src={product.image_url} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-xl font-semibold tracking-tight sm:text-2xl">{product.title ?? "Your product"}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <a
              href={`https://www.${market.domain}/dp/${product.asin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 font-mono hover:text-brand"
            >
              {market.flag} {product.asin} <ExternalLink className="size-3" />
            </a>
            {latestBsr && (
              <span className="rounded-md border bg-card px-2 py-0.5">
                BSR <span className="font-medium text-foreground">#{latestBsr.rank.toLocaleString()}</span> · {latestBsr.category}
              </span>
            )}
            <span>{detail.keywords.length} keyword{detail.keywords.length === 1 ? "" : "s"} tracked</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckNowButton productId={product.id} />
          <DeleteProductButton productId={product.id} />
        </div>
      </header>

      {/* The banner is about keyword ranks (sample data until a rank provider is connected). */}
      {query.tab === "keywords" && (
        <Suspense>
          <DataSourceBanner />
        </Suspense>
      )}

      <nav className="-mx-4 flex gap-6 overflow-x-auto whitespace-nowrap border-b border-line px-4 text-sm sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={href({ tab: t.id })}
            className={`-mb-px border-b-2 pb-2.5 text-[13px] font-medium transition ${
              query.tab === t.id ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {query.tab === "overview" && (
        <Suspense fallback={<div className="card h-72 animate-pulse" />}>
          <OverviewTab detail={detail} sqpQueries={sqpQueries} query={query} />
        </Suspense>
      )}
      {query.tab === "keywords" && <KeywordsTab detail={detail} query={query} href={href} />}
      {query.tab === "sales" && (
        <Suspense fallback={<div className="h-72 animate-pulse rounded-lg border bg-card" />}>
          <SalesSection productId={product.id} query={query} />
        </Suspense>
      )}
      {query.tab === "ads" && (
        <Suspense fallback={<div className="h-72 animate-pulse rounded-lg border bg-card" />}>
          <AdsSection productId={product.id} query={query} />
        </Suspense>
      )}
      {query.tab === "competitors" && (
        <Suspense fallback={<div className="h-72 animate-pulse rounded-lg border bg-card" />}>
          <CompetitorsSection productId={product.id} query={query} />
        </Suspense>
      )}
      {query.tab === "queries" && (
        <Suspense fallback={<div className="card h-72 animate-pulse" />}>
          <SqpSection productId={product.id} query={query} currency={market.currency} />
        </Suspense>
      )}
    </div>
  );
}

async function OverviewTab({ detail, sqpQueries, query }: { detail: ProductDetail; sqpQueries: Awaited<ReturnType<typeof getSqpQueries>>; query: Query }) {
  // Periods depend on the current time, so render per request.
  await connection();
  const period = resolvePeriod(isPeriodKey(query.period) ? query.period : "last_30", query.from, query.to);
  const ranksAreReal = !getSerpProvider().isDemo;
  const trends = keywordTrends(detail.keywords, detail.dates, detail.latestDate);
  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <DashboardControls period={period.key} from={period.from} to={period.to} marketplace={detail.product.marketplace} marketplaceOptions={[]} />
      </div>
      <ProductOverview productId={detail.product.id} asin={detail.product.asin} marketplace={detail.product.marketplace} period={period} />
      {ranksAreReal ? (
        <section className="space-y-4">
          <SectionHeader title="Keyword ranks" />
          <MoversAndOpportunities productId={detail.product.id} trends={trends} sqpQueries={sqpQueries} />
          <Standing detail={detail} trends={trends} />
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">
          Keyword ranks aren&apos;t shown here while they&apos;re sample data. Connect DataForSEO in{" "}
          <Link href="/settings#rank-data" className="font-medium text-brand hover:text-brand-dark">Settings</Link> to track real Amazon rankings.
        </p>
      )}
    </div>
  );
}

async function KeywordsTab({ detail, query, href }: { detail: ProductDetail; query: Query; href: (c: Partial<Query>) => string }) {
  const keywords = query.q ? detail.keywords.filter((k) => k.keyword.includes(query.q)) : detail.keywords;
  const trends = keywordTrends(keywords, detail.dates, detail.latestDate, query.mode);
  const keywordAds = await getKeywordAds(detail.product.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Rank type"
          options={(["organic", "sponsored"] as const).map((m) => ({ href: href({ mode: m }), label: m === "organic" ? "Organic" : "Sponsored", active: query.mode === m }))}
        />
        <Segmented
          label="View"
          options={[
            { href: href({ view: "list" }), label: <><List /> List</>, active: query.view === "list" },
            { href: href({ view: "grid" }), label: <><LayoutGrid /> Daily grid</>, active: query.view === "grid" },
          ]}
        />
        <Segmented label="History" options={[7, 14, 30].map((r) => ({ href: href({ range: r }), label: `${r} days`, active: query.range === r }))} />
        <form className="relative w-full sm:w-48" action="">
          <input type="hidden" name="tab" value="keywords" />
          <input type="hidden" name="range" value={query.range} />
          <input type="hidden" name="mode" value={query.mode} />
          <input type="hidden" name="view" value={query.view} />
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={query.q} placeholder="Find a keyword" className="h-8 pl-8 text-[13px]" />
        </form>
        <div className="ml-auto flex gap-2">
          <a href={`/products/${detail.product.id}/export?range=${query.range}`} className="btn">
            <Download /> CSV
          </a>
          <AddKeywordsButton productId={detail.product.id} />
        </div>
      </div>

      <KeywordTable
        productId={detail.product.id}
        amazonDomain={marketplaces[detail.product.marketplace].domain}
        trends={trends}
        dates={detail.dates}
        mode={query.mode}
        view={query.view}
        hasSqp={Boolean(detail.sqpWeek)}
        ads={Object.keys(keywordAds).length ? keywordAds : null}
        currency={marketplaces[detail.product.marketplace].currency}
      />
    </div>
  );
}

async function SqpSection({ productId, query, currency }: { productId: number; query: Query; currency: string }) {
  // Periods depend on the current time, so render per request.
  await connection();
  const period = resolvePeriod(isPeriodKey(query.period) ? query.period : "last_30", query.from, query.to);
  const data = await getSqpPerformance(productId, { from: period.from, to: period.to });
  if (!data.hasData) {
    if (!isSpApiConfigured()) return <SpApiNote what="Search Query Performance" />;
    return (
      <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center text-[13px] text-muted-foreground">
        No Search Query Performance data yet. Amazon publishes it weekly for brand-registered products; SellerDoos fetches the last 8 weeks
        automatically. You can also click “Sync Amazon data” in <Link href="/settings" className="font-semibold text-brand">Settings</Link>.
      </div>
    );
  }
  return <SqpTab productId={productId} data={data} currency={currency} period={{ key: period.key, from: period.from, to: period.to, label: period.label }} />;
}

function SpApiNote({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center text-[13px] text-muted-foreground">
      {what} comes from Amazon&apos;s Selling Partner API. Connect Seller Central in{" "}
      <Link href="/settings#connect" className="font-medium text-brand">
        Settings
      </Link>
      .
    </div>
  );
}


/** The tab's date range from the URL (default: last 30 days). Periods depend on the current time. */
async function tabPeriod(query: Query) {
  await connection();
  return resolvePeriod(isPeriodKey(query.period) ? query.period : "last_30", query.from, query.to);
}

/** Date picker row shown at the top of a dated tab. */
function TabControls({ period }: { period: Awaited<ReturnType<typeof tabPeriod>> }) {
  return (
    <div className="flex justify-end">
      <DashboardControls period={period.key} from={period.from} to={period.to} marketplace="US" marketplaceOptions={[]} />
    </div>
  );
}

async function SalesSection({ productId, query }: { productId: number; query: Query }) {
  const period = await tabPeriod(query);
  const [sales, orders] = await Promise.all([getSalesDetail(productId, { from: period.from, to: period.to }), getProductOrders(productId)]);
  return (
    <div className="space-y-5">
      <TabControls period={period} />
      {sales && <SalesTab productId={productId} sales={sales} demo={!isSpApiConfigured()} orders={orders} />}
    </div>
  );
}

async function AdsSection({ productId, query }: { productId: number; query: Query }) {
  const period = await tabPeriod(query);
  const [ads, orders] = await Promise.all([getAdsDetail(productId, { from: period.from, to: period.to }), getProductOrders(productId)]);
  return (
    <div className="space-y-5">
      <TabControls period={period} />
      {ads && <AdsTab productId={productId} ads={ads} currency={ads.currency} demo={!isAdsConfigured()} orders={orders} />}
    </div>
  );
}

async function CompetitorsSection({ productId, query }: { productId: number; query: Query }) {
  const period = await tabPeriod(query);
  const data = await getCompetitorDetail(productId, { from: period.from, to: period.to });
  return (
    <div className="space-y-5">
      <TabControls period={period} />
      {data && <CompetitorsTab productId={productId} data={data} demo={!isSpApiConfigured()} />}
    </div>
  );
}
