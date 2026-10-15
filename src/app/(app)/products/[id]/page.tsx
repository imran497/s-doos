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
import { BriefingCard, MoversAndOpportunities, Standing } from "@/components/product/Overview";
import { DeleteProductButton, TrackButton } from "@/components/product/SmallActions";
import { buildBriefing, keywordTrends } from "@/lib/insights";
import { marketplaces } from "@/lib/marketplaces";
import { compact, pct } from "@/lib/metrics";
import { getProductDetail, getSqpQueries, type ProductDetail } from "@/lib/queries";
import { isAdsConfigured } from "@/lib/amazon/ads";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { commerceSignals, getAdsDetail, getCompetitorDetail, getKeywordAds, getSalesDetail } from "@/lib/commerce";

export const metadata: Metadata = { title: "Product" };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "keywords", label: "Keywords" },
  { id: "sales", label: "Sales & profit" },
  { id: "ads", label: "Ads" },
  { id: "competitors", label: "Competitors" },
  { id: "queries", label: "Search queries" },
] as const;

/** Tabs that use the 7/14/30-day range picker. */
const RANGED = new Set(["keywords", "sales", "ads", "competitors"]);

type Query = {
  tab: (typeof TABS)[number]["id"];
  range: number;
  mode: "organic" | "sponsored";
  view: "list" | "grid";
  q: string;
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
    return `/products/${product.id}?${params}`;
  };

  const latestBsr = detail.bsr.at(-1);

  return (
    <div className="space-y-6">
      <Link href="/products" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-ink">
        <ArrowLeft className="size-4" /> Products
      </Link>

      <header className="flex flex-wrap items-center gap-5">
        <ProductThumb src={product.image_url} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-xl font-extrabold tracking-tight sm:text-2xl">
            {product.title ?? "Your product"}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <a
              href={`https://www.${market.domain}/dp/${product.asin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 font-mono text-xs shadow-sm hover:text-brand"
            >
              {market.flag} {product.asin} <ExternalLink className="size-3" />
            </a>
            {latestBsr && (
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold shadow-sm">
                BSR #{latestBsr.rank.toLocaleString()} · {latestBsr.category}
              </span>
            )}
            <span className="text-xs">{detail.keywords.length} keywords tracked</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckNowButton productId={product.id} />
          <DeleteProductButton productId={product.id} />
        </div>
      </header>

      <Suspense>
        <DataSourceBanner />
      </Suspense>

      <nav className="-mx-4 flex gap-6 overflow-x-auto whitespace-nowrap border-b border-line px-4 text-sm sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={href({ tab: t.id })}
            className={`-mb-px border-b-2 pb-3 font-semibold transition ${
              query.tab === t.id ? "border-brand text-ink" : "border-transparent text-muted-foreground hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {RANGED.has(query.tab) && query.tab !== "keywords" && <RangePicker query={query} href={href} />}
      {query.tab === "overview" && <OverviewTab detail={detail} sqpQueries={sqpQueries} />}
      {query.tab === "keywords" && <KeywordsTab detail={detail} query={query} href={href} />}
      {query.tab === "sales" && <SalesSection productId={product.id} range={query.range} />}
      {query.tab === "ads" && <AdsSection productId={product.id} range={query.range} />}
      {query.tab === "competitors" && <CompetitorsSection productId={product.id} range={query.range} />}
      {query.tab === "queries" && <QueriesTab productId={product.id} rows={sqpQueries} />}
    </div>
  );
}

async function OverviewTab({ detail, sqpQueries }: { detail: ProductDetail; sqpQueries: Awaited<ReturnType<typeof getSqpQueries>> }) {
  const trends = keywordTrends(detail.keywords, detail.dates, detail.latestDate);
  const briefing = buildBriefing(trends, sqpQueries.filter((q) => !q.tracked).length, await commerceSignals(detail.product.id));
  return (
    <div className="space-y-6">
      <BriefingCard briefing={briefing} latestDate={detail.latestDate} />
      <MoversAndOpportunities productId={detail.product.id} trends={trends} sqpQueries={sqpQueries} />
      <Standing detail={detail} trends={trends} />
    </div>
  );
}

async function KeywordsTab({ detail, query, href }: { detail: ProductDetail; query: Query; href: (c: Partial<Query>) => string }) {
  const keywords = query.q ? detail.keywords.filter((k) => k.keyword.includes(query.q)) : detail.keywords;
  const trends = keywordTrends(keywords, detail.dates, detail.latestDate, query.mode);
  const keywordAds = await getKeywordAds(detail.product.id);
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-semibold transition ${active ? "bg-ink text-white" : "text-muted-foreground hover:text-ink"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-white p-1 text-sm shadow-sm">
          {(["organic", "sponsored"] as const).map((m) => (
            <Link key={m} href={href({ mode: m })} className={`${pill(query.mode === m)} capitalize`}>
              {m}
            </Link>
          ))}
        </div>
        <div className="flex rounded-full bg-white p-1 text-sm shadow-sm">
          <Link href={href({ view: "list" })} className={pill(query.view === "list")}>
            <List className="size-3.5" /> List
          </Link>
          <Link href={href({ view: "grid" })} className={pill(query.view === "grid")}>
            <LayoutGrid className="size-3.5" /> Daily grid
          </Link>
        </div>
        <div className="flex rounded-full bg-white p-1 text-sm shadow-sm">
          {[7, 14, 30].map((r) => (
            <Link key={r} href={href({ range: r })} className={pill(query.range === r)}>
              {r} days
            </Link>
          ))}
        </div>
        <form className="relative" action="">
          <input type="hidden" name="tab" value="keywords" />
          <input type="hidden" name="range" value={query.range} />
          <input type="hidden" name="mode" value={query.mode} />
          <input type="hidden" name="view" value={query.view} />
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={query.q} placeholder="Find a keyword" className="field w-44 rounded-full pl-9" />
        </form>
        <div className="ml-auto flex gap-2">
          <a href={`/products/${detail.product.id}/export?range=${query.range}`} className="btn">
            <Download className="size-4" /> CSV
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

function QueriesTab({ productId, rows }: { productId: number; rows: Awaited<ReturnType<typeof getSqpQueries>> }) {
  if (!rows.length) {
    if (!isSpApiConfigured()) return <SpApiNote what="Search query data" />;
    return (
      <div className="card p-10 text-center text-sm text-muted-foreground">
        No SQP data yet. Open <Link href="/settings" className="font-semibold text-brand">Settings</Link> and click “Sync Amazon data”. Amazon takes a few
        minutes to build each weekly report.
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto">
      <div className="px-6 pt-6">
        <p className="eyebrow">
          Week of {rows[0].week_start} to {rows[0].week_end}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Every search where shoppers saw your product, from Amazon&apos;s Search Query Performance report.</p>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead className="border-y border-line text-right text-xs font-semibold text-muted-foreground">
          <tr>
            <th className="px-6 py-3 text-left">Search query</th>
            <th className="px-3 py-3">Searches</th>
            <th className="px-3 py-3">Impression share</th>
            <th className="px-3 py-3">Click share</th>
            <th className="px-3 py-3">Cart adds</th>
            <th className="px-3 py-3">Sales</th>
            <th className="px-3 py-3">Sales share</th>
            <th className="px-6 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line text-right tabular-nums">
          {rows.map((r) => (
            <tr key={r.search_query} className="hover:bg-canvas/60">
              <td className="px-6 py-3 text-left font-semibold">{r.search_query}</td>
              <td className="px-3 py-3">{r.query_volume?.toLocaleString() ?? "–"}</td>
              <td className="px-3 py-3">{pct(r.asin_impressions, r.impressions)}</td>
              <td className="px-3 py-3">{pct(r.asin_clicks, r.clicks)}</td>
              <td className="px-3 py-3">{compact(r.asin_cart_adds)}</td>
              <td className="px-3 py-3">{compact(r.asin_purchases)}</td>
              <td className="px-3 py-3">{pct(r.asin_purchases, r.purchases)}</td>
              <td className="px-6 py-3">
                {r.tracked ? <span className="text-xs font-semibold text-brand">Tracking</span> : <TrackButton productId={productId} keyword={r.search_query} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpApiNote({ what }: { what: string }) {
  return (
    <div className="card p-10 text-center text-sm text-muted-foreground">
      {what} comes from Amazon&apos;s Selling Partner API. Add your SP-API keys to <code className="font-mono">.env.local</code>; see{" "}
      <Link href="/settings" className="font-semibold text-brand">Settings</Link>.
    </div>
  );
}

function RangePicker({ query, href }: { query: Query; href: (c: Partial<Query>) => string }) {
  return (
    <div className="flex w-fit rounded-full bg-white p-1 text-sm shadow-sm">
      {[7, 14, 30].map((r) => (
        <Link
          key={r}
          href={href({ range: r })}
          className={`rounded-full px-3.5 py-1.5 font-semibold transition ${query.range === r ? "bg-ink text-white" : "text-muted-foreground hover:text-ink"}`}
        >
          {r} days
        </Link>
      ))}
    </div>
  );
}

async function SalesSection({ productId, range }: { productId: number; range: number }) {
  const sales = await getSalesDetail(productId, range);
  return sales && <SalesTab productId={productId} sales={sales} demo={!isSpApiConfigured()} />;
}

async function AdsSection({ productId, range }: { productId: number; range: number }) {
  const ads = await getAdsDetail(productId, range);
  return ads && <AdsTab productId={productId} ads={ads} currency={ads.currency} demo={!isAdsConfigured()} />;
}

async function CompetitorsSection({ productId, range }: { productId: number; range: number }) {
  const data = await getCompetitorDetail(productId, range);
  return data && <CompetitorsTab productId={productId} data={data} demo={!isSpApiConfigured()} />;
}
