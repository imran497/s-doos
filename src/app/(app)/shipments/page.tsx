import { Suspense } from "react";
import type { Metadata } from "next";
import { formatValue } from "@/components/dashboard/format";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { ProductThumb } from "@/components/ProductThumb";
import { ShipmentsTable } from "@/components/shipments/ShipmentsTable";
import { Skeleton } from "@/components/ui/skeleton";
import { getShipments } from "@/lib/shipments";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Shipments" };

export default function ShipmentsPage(props: PageProps<"/shipments">) {
  return (
    <div className="space-y-8">
      <PageHeader title="Shipments" description="What you bought and sent to Amazon. Its landed cost is your cost of goods." />
      <Suspense fallback={<ShipmentsSkeleton />}>
        <ShipmentsContent {...props} />
      </Suspense>
    </div>
  );
}

const money = (n: number) => formatValue("money", n, "USD");

async function ShipmentsContent({ searchParams }: PageProps<"/shipments">) {
  const sp = await searchParams;
  const startAdding = sp.add === "1";
  const startViewing = typeof sp.view === "string" ? sp.view : undefined;
  const { shipments, summary, stock, nextRef, products } = await getShipments();
  const cards = [
    { label: "Inventory at Amazon", value: money(summary.atAmazon), hint: "Unsold units from arrived shipments, at cost" },
    { label: "Paid, not arrived", value: money(summary.paidNotArrived), hint: "Shipments ordered or in transit" },
    { label: "Units on the way", value: summary.unitsOnTheWay.toLocaleString(), hint: "Not at Amazon yet" },
    { label: "Total invested", value: money(summary.invested), hint: "Every shipment, including shared costs" },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-card px-4 py-4 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
            <p className="text-[13px] font-medium text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{c.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
          </div>
        ))}
      </div>

      <ShipmentsTable shipments={shipments} nextRef={nextRef} products={products} startAdding={startAdding} startViewing={startViewing} />

      {stock.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Stock check" meta="Units your shipments say are at Amazon vs. what Amazon reports" />
          <div className="overflow-x-auto rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-canvas text-xs text-muted-foreground">
                <tr className="border-b [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
                  <th className="text-left">Product</th>
                  <th className="text-right">Received</th>
                  <th className="text-right" title="Orders matched to these shipments, plus units Amazon no longer has without a matching order">
                    Sold or gone
                  </th>
                  <th className="text-right">Should be at Amazon</th>
                  <th className="text-right">Amazon reports</th>
                  <th className="text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => {
                  const diff = s.amazon == null ? null : s.amazon - s.expected;
                  return (
                    <tr key={s.asin} className="border-b last:border-0 [&>td]:px-4 [&>td]:py-2.5">
                      <td>
                        <span className="flex items-center gap-2">
                          <ProductThumb src={s.imageUrl} size={24} />
                          <span className="max-w-[340px] truncate font-medium" title={s.title}>
                            {s.title}
                          </span>
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{s.received.toLocaleString()}</td>
                      <td className="text-right tabular-nums" title={s.untracked ? `${s.untracked} of these have no matching order in SellerDoos yet (earlier sales, Vine, removals or damage)` : undefined}>
                        {s.sold.toLocaleString()}
                        {s.untracked > 0 && <span className="text-muted-foreground"> *</span>}
                      </td>
                      <td className="text-right tabular-nums">{s.expected.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{s.amazon == null ? "—" : s.amazon.toLocaleString()}</td>
                      <td className={cn("text-right font-medium tabular-nums", diff != null && diff !== 0 && "text-[#8a5a12]")}>
                        {diff == null ? "—" : diff === 0 ? "Matches" : `${diff > 0 ? "+" : ""}${diff.toLocaleString()}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stock.some((s) => s.untracked > 0) && (
            <p className="text-xs text-muted-foreground">
              * Includes units that left stock without an order SellerDoos has seen yet. These are costed first, as the oldest stock. Older orders are being
              fetched back to your first shipment, so this should shrink after the next syncs.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function ShipmentsSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
