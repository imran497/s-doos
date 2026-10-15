"use client";

import { Pencil } from "lucide-react";
import { formatValue } from "@/components/dashboard/format";
import { ProductThumb } from "@/components/ProductThumb";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Shipment } from "@/lib/shipments";
import { cn } from "@/lib/utils";

const money = (n: number) => formatValue("money", n, "USD");
const date = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const STATUS = { ordered: "Ordered", in_transit: "In transit", arrived: "Arrived at Amazon" } as const;

/** Read-only details of one shipment: what was paid, how it adds up to cost per unit, and what's sold. */
export function ShipmentView({ shipment: s, open, onOpenChange, onEdit }: {
  shipment: Shipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (s: Shipment) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {s && <Body s={s} onEdit={onEdit} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ s, onEdit }: { s: Shipment; onEdit: (s: Shipment) => void }) {
  const linesPaid = s.lines.reduce((n, l) => n + l.totalPaid, 0);
  const sold = s.lines.reduce((n, l) => n + l.sold, 0);
  const left = s.lines.reduce((n, l) => n + l.remaining, 0);
  const valueLeft = s.lines.reduce((n, l) => n + l.remaining * l.landedUnitCost, 0);

  return (
    <div className="flex min-h-full flex-col">
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle className="flex items-center gap-2 text-base">
          {s.ref}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              s.status === "arrived" ? "bg-positive-soft text-positive" : s.status === "in_transit" ? "bg-[#fdf1dc] text-[#8a5a12]" : "bg-[#f1f3f7] text-[#545969]",
            )}
          >
            {STATUS[s.status]}
          </span>
        </SheetTitle>
        <SheetDescription className="text-[13px]">
          {s.supplier || "No supplier entered"} · Ordered {date(s.orderDate)}
          {s.arrivedDate ? ` · Arrived ${date(s.arrivedDate)}` : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 px-6 py-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Units", value: s.units.toLocaleString() },
            { label: "Total cost", value: money(s.totalCost) },
            { label: "Sold", value: `${sold.toLocaleString()} of ${s.units.toLocaleString()}` },
            { label: "Left, at cost", value: `${left.toLocaleString()} · ${money(valueLeft)}` },
          ].map((x) => (
            <div key={x.label} className="rounded-md border bg-canvas/50 px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">{x.label}</dt>
              <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{x.value}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold">Products</h3>
          <div className="space-y-3">
            {s.lines.map((l) => (
              <div key={l.id} className="rounded-md border">
                <div className="flex items-center gap-3 border-b px-3 py-2.5">
                  <ProductThumb src={l.imageUrl} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium" title={l.title}>
                      {l.title}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">{l.asin}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[15px] font-semibold tabular-nums">{money(l.landedUnitCost)}</p>
                    <p className="text-[11px] text-muted-foreground">cost per unit</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-3 py-2.5 text-[13px] sm:grid-cols-3">
                  <Row label="Quantity" value={l.qty.toLocaleString()} />
                  <Row label="Unit price" value={l.unitPrice ? money(l.unitPrice) : "—"} />
                  <Row label="Misc charges" value={l.miscCharges ? money(l.miscCharges) : "—"} />
                  <Row label="Total paid" value={money(l.totalPaid)} />
                  <Row label="Paid per unit" value={money(l.qty ? Math.round((l.totalPaid / l.qty) * 100) / 100 : 0)} />
                  <Row label="Shared costs / unit" value={money(l.sharedPerUnit)} />
                  <Row label="Sold" value={l.sold.toLocaleString()} />
                  <Row label="Left" value={l.remaining.toLocaleString()} />
                  <Row label="Left, at cost" value={money(l.remaining * l.landedUnitCost)} />
                </dl>
                {l.notes && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{l.notes}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold">How the total adds up</h3>
          <dl className="rounded-md border text-[13px]">
            <Line label="Paid for products" value={money(linesPaid)} />
            <Line label="Amazon placement fee" value={money(s.placementFee)} hint={s.units ? `${money(s.placementFee / s.units)} per unit` : undefined} />
            {s.otherCosts > 0 && <Line label="Other shipment costs" value={money(s.otherCosts)} hint={s.units ? `${money(s.otherCosts / s.units)} per unit` : undefined} />}
            <Line label="Total cost" value={money(s.totalCost)} strong />
          </dl>
          <p className="text-xs text-muted-foreground">
            Cost per unit = total paid ÷ quantity, plus the placement fee and other costs shared equally by all {s.units.toLocaleString()} units. Sales use the
            oldest shipment first.
          </p>
        </section>

        {s.notes && (
          <section className="space-y-1">
            <h3 className="text-[13px] font-semibold">Notes</h3>
            <p className="text-[13px] text-muted-foreground">{s.notes}</p>
          </section>
        )}
      </div>

      <SheetFooter className="sticky bottom-0 flex-row justify-end border-t bg-popover px-6 py-3">
        <Button size="sm" variant="outline" onClick={() => onEdit(s)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      </SheetFooter>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Line({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b px-3 py-2 last:border-0", strong && "bg-canvas/60 font-semibold")}>
      <dt className={strong ? "" : "text-muted-foreground"}>
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
