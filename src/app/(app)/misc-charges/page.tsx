import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { formatValue } from "@/components/dashboard/format";
import { ExpensesView, SyncExpensesButton } from "@/components/expenses/ExpensesView";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { getExpenses } from "@/lib/expenses";
import { isPeriodKey, resolvePeriod } from "@/lib/periods";

export const metadata: Metadata = { title: "Misc charges" };

export default function MiscChargesPage(props: PageProps<"/misc-charges">) {
  return (
    <Suspense fallback={<MiscSkeleton />}>
      <MiscContent {...props} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const money = (n: number) => formatValue("money", n, "USD");

async function MiscContent({ searchParams }: PageProps<"/misc-charges">) {
  const sp = await searchParams;
  await connection();
  const key = one(sp.period);
  const period = resolvePeriod(isPeriodKey(key) ? key : "last_12m", one(sp.from), one(sp.to));
  const data = await getExpenses(period);
  const t = data.totals;

  const cards = [
    { label: "Total misc charges", value: money(t.counted), hint: period.label },
    { label: "Amazon", value: money(t.amazon), hint: "Subscription, storage, coupons… (automatic)" },
    { label: "Advertising", value: money(t.advertising), hint: "Entered by you until Amazon Ads is connected" },
    { label: "Your costs", value: money(t.own), hint: "Tools, samples, trademark, inspections…" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Misc charges"
        description="Business costs beyond per-order fees. Amazon's account charges come in automatically; add the rest yourself."
        actions={
          <>
            <SyncExpensesButton lastSynced={data.lastSynced} />
            <DashboardControls period={period.key} from={period.from} to={period.to} marketplace="US" marketplaceOptions={[]} />
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-card px-4 py-4 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
            <p className="text-[13px] font-medium text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{c.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
          </div>
        ))}
      </div>
      {(t.inShipments > 0 || t.transfers > 0) && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Not counted:{" "}
          {t.inShipments > 0 && <>{money(t.inShipments)} of inbound placement fees (already in your shipment costs)</>}
          {t.inShipments > 0 && t.transfers > 0 && " and "}
          {t.transfers > 0 && <>{money(t.transfers)} of negative balance payments (your card covering fees that are already counted)</>}.
        </p>
      )}

      <ExpensesView data={data} startAdding={one(sp.add) === "1"} />
    </div>
  );
}

function MiscSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}
