"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatValue } from "@/components/dashboard/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProductOrder } from "@/lib/product-orders";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 5;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Every sale of the product, newest first, 5 per page. */
export function OrdersList({ orders }: { orders: ProductOrder[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const visible = orders.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const money = (n: number | null, currency: string) => (n == null ? "—" : formatValue("money", n, currency));
  const units = orders.filter((o) => o.status !== "Cancelled").reduce((n, o) => n + o.units, 0);

  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-[13px] font-semibold">
          All sales <span className="font-normal text-muted-foreground">({orders.length} orders · {units.toLocaleString()} units)</span>
        </h3>
        <span className="text-xs text-muted-foreground">Payout is what Amazon settles after its fees; profit also takes off the landed cost.</span>
      </div>
      {orders.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="bg-canvas text-xs text-muted-foreground">
                <tr className="border-b [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium [&>th]:whitespace-nowrap">
                  <th className="text-left">Date</th>
                  <th className="text-left">Order</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Promotion</th>
                  <th className="text-right">Amazon payout</th>
                  <th className="text-right">Cost of goods</th>
                  <th className="text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => {
                  const cancelled = o.status === "Cancelled";
                  return (
                    <tr key={o.orderId} className={cn("border-b last:border-0", cancelled && "text-muted-foreground")}>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{when(o.date)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{o.orderId}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <StatusBadge status={o.status} />
                          {o.free && (
                            <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-dark" title="Price fully discounted by a promotion (Vine, replacement)">
                              Free
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{o.units}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(o.price, o.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{o.promotion ? `−${money(o.promotion, o.currency)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {o.payoutEstimated && o.payout != null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help border-b border-dotted border-muted-foreground/50">~{money(o.payout, o.currency)}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-60">Not settled yet. Estimated from the price and Amazon&apos;s fee estimate; Amazon pays about a week after delivery.</TooltipContent>
                          </Tooltip>
                        ) : (
                          money(o.payout, o.currency)
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(o.cogs, "USD")}</td>
                      <td className={cn("px-4 py-2.5 text-right font-medium tabular-nums", o.profit != null && !cancelled && (o.profit < 0 ? "text-destructive" : "text-positive"))}>
                        {cancelled ? "—" : money(o.profit, o.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min(orders.length, page * PAGE_SIZE + PAGE_SIZE)} of {orders.length}
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">
                Page {page + 1} of {pages}
              </span>
              <Button variant="outline" size="icon" className="size-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-7" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </span>
          </div>
        </>
      ) : (
        <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">No orders for this product yet.</p>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "Shipped" ? "bg-positive-soft text-positive" : status === "Cancelled" ? "bg-[#f1f3f7] text-[#545969]" : "bg-[#fdf1dc] text-[#8a5a12]";
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>{status}</span>;
}
