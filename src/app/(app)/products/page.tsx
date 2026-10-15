import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AddProductButton } from "@/components/AddProductForm";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { PageHeader } from "@/components/PageHeader";
import { ProductsTable } from "@/components/products/ProductsTable";
import { Skeleton } from "@/components/ui/skeleton";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { isMarketplace, marketplaces, type MarketplaceCode } from "@/lib/marketplaces";
import { isPeriodKey, resolvePeriod } from "@/lib/periods";
import { getProductTable, productMarketplaces } from "@/lib/products-table";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage(props: PageProps<"/products">) {
  return (
    <Suspense fallback={<ProductsSkeleton />}>
      <ProductsContent {...props} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function ProductsContent({ searchParams }: PageProps<"/products">) {
  const sp = await searchParams;
  await connection();
  const key = one(sp.period);
  const period = resolvePeriod(isPeriodKey(key) ? key : "last_30", one(sp.from), one(sp.to));
  const available = await productMarketplaces();
  const requested = one(sp.m);
  const marketplace: MarketplaceCode = requested && isMarketplace(requested) ? requested : (available[0] ?? "US");
  const table = await getProductTable(period, marketplace);
  const connected = isSpApiConfigured();

  const description = [
    `${marketplaces[marketplace].flag} ${marketplaces[marketplace].name}`,
    table.demo ? "Sample data" : table.listingsUpdatedAt ? `Listings updated ${table.listingsUpdatedAt.slice(0, 16)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description={description}
        actions={
          <>
            {!connected && <AddProductButton />}
            <DashboardControls
              period={period.key}
              from={period.from}
              to={period.to}
              marketplace={marketplace}
              marketplaceOptions={(available.length ? available : [marketplace]).map((m) => ({ code: m, label: `${marketplaces[m].flag}  ${marketplaces[m].name}` }))}
            />
          </>
        }
      />

      {table.rows.length ? (
        <ProductsTable rows={table.rows} periodLabel={period.label} initialOpen={Number(one(sp.open)) || undefined} />
      ) : (
        <div className="rounded-lg border border-dashed bg-card px-6 py-14 text-center">
          <p className="text-[15px] font-semibold">{connected ? "Your listings are on their way" : "No products yet"}</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
            {connected
              ? "SellerDoos asks Amazon for your listings report once a day. It usually arrives within a few minutes; you can also press Sync in Settings."
              : "Connect Seller Central and every product you sell shows up here automatically."}
          </p>
          <Link href={connected ? "/settings#schedule" : "/settings#connect"} className="btn-primary mt-4">
            {connected ? "Sync now" : "Connect Seller Central"}
          </Link>
        </div>
      )}
      {/* Opens the add dialog when the menu links here with ?add=1 (before Seller Central is connected). */}
      {!connected && (
        <div className="hidden">
          <AddProductButton variant="tile" />
        </div>
      )}
    </div>
  );
}

function ProductsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="rounded-lg border bg-card">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
