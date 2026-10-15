"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveShipment } from "@/app/actions";
import { formatValue } from "@/components/dashboard/format";
import { ProductThumb } from "@/components/ProductThumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { defaultTotalPaid, landedUnitCost, SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/cogs-math";
import type { ProductOption, Shipment } from "@/lib/shipments";

type LineDraft = { key: number; asin: string; qty: string; unitPrice: string; miscCharges: string; totalPaid: string; notes: string };

let nextKey = 1;
const blankLine = (): LineDraft => ({ key: nextKey++, asin: "", qty: "", unitPrice: "", miscCharges: "", totalPaid: "", notes: "" });
const num = (v: string) => Number(v.replace(/[$,]/g, "")) || 0;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Side panel to add or edit a shipment and its products, with a live landed-cost preview. */
export function ShipmentForm({ open, onOpenChange, shipment, nextRef, products }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = new shipment. */
  shipment: Shipment | null;
  nextRef: string;
  products: ProductOption[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {/* Remount per shipment so the fields start from its values. */}
        {open && <FormBody key={shipment?.id ?? "new"} shipment={shipment} nextRef={nextRef} products={products} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function FormBody({ shipment, nextRef, products, onDone }: { shipment: Shipment | null; nextRef: string; products: ProductOption[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveShipment, undefined);
  const [status, setStatus] = useState<ShipmentStatus>(shipment?.status ?? "ordered");
  const [placementFee, setPlacementFee] = useState(shipment ? String(shipment.placementFee || "") : "");
  const [otherCosts, setOtherCosts] = useState(shipment ? String(shipment.otherCosts || "") : "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    shipment?.lines.length
      ? shipment.lines.map((l) => ({
          key: nextKey++,
          asin: l.asin,
          qty: String(l.qty),
          unitPrice: l.unitPrice ? String(l.unitPrice) : "",
          miscCharges: l.miscCharges ? String(l.miscCharges) : "",
          totalPaid: String(l.totalPaid),
          notes: l.notes,
        }))
      : [blankLine()],
  );

  useEffect(() => {
    if (state?.message) onDone();
  }, [state, onDone]);

  const update = (key: number, change: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));

  // Live preview, same arithmetic as the server.
  const preview = useMemo(() => {
    const priced = lines.map((l) => {
      const qty = Math.max(0, Math.floor(num(l.qty)));
      const paid = l.totalPaid.trim() ? num(l.totalPaid) : defaultTotalPaid(qty, num(l.unitPrice), num(l.miscCharges));
      return { qty, paid };
    });
    const units = priced.reduce((s, l) => s + l.qty, 0);
    const shared = num(placementFee) + num(otherCosts);
    return {
      units,
      total: priced.reduce((s, l) => s + l.paid, 0) + shared,
      perLine: priced.map((l) => ({ ...l, landed: landedUnitCost({ qty: l.qty, totalPaid: l.paid }, shared, units) })),
    };
  }, [lines, placementFee, otherCosts]);

  const money = (n: number) => formatValue("money", n, "USD");

  return (
    <form action={action} className="flex min-h-full flex-col">
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle className="text-base">{shipment ? `Edit ${shipment.ref}` : "Add shipment"}</SheetTitle>
        <SheetDescription className="text-[13px]">
          Each product&apos;s cost per unit = what you paid ÷ quantity, plus its share of the shipment&apos;s Amazon placement fee and other costs.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 px-6 py-5">
        {shipment && <input type="hidden" name="id" value={shipment.id} />}
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({ asin: l.asin, qty: l.qty, unitPrice: l.unitPrice, miscCharges: l.miscCharges, totalPaid: l.totalPaid, notes: l.notes })))} />

        <section className="grid gap-4 sm:grid-cols-3">
          <Field label="Reference">
            <Input name="ref" defaultValue={shipment?.ref ?? nextRef} required className="h-8 text-[13px]" />
          </Field>
          <Field label="Supplier">
            <Input name="supplier" defaultValue={shipment?.supplier ?? ""} placeholder="e.g. Alibaba – Zoe Chen" className="h-8 text-[13px]" />
          </Field>
          <Field label="Order date">
            <Input name="orderDate" type="date" defaultValue={shipment?.orderDate ?? today()} required className="h-8 text-[13px]" />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as ShipmentStatus)}>
              <SelectTrigger size="sm" className="h-8 w-full text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIPMENT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-[13px]">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {status === "arrived" && (
            <Field label="Arrived at Amazon">
              <Input name="arrivedDate" type="date" defaultValue={shipment?.arrivedDate ?? today()} required className="h-8 text-[13px]" />
            </Field>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Products</h3>
            <span className="text-xs text-muted-foreground">Leave &quot;Total paid&quot; empty to use qty × unit price + misc.</span>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-canvas text-xs text-muted-foreground">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:whitespace-nowrap">
                  <th className="w-[38%] pl-3">Product</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Misc</th>
                  <th>Total paid</th>
                  <th className="text-right">Cost / unit</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} className="border-t align-middle [&>td]:px-2 [&>td]:py-2">
                    <td className="pl-3">
                      <Select value={l.asin} onValueChange={(asin) => update(l.key, { asin })}>
                        <SelectTrigger size="sm" className="h-8 w-full max-w-[260px] text-[13px]" aria-label={`Product on line ${i + 1}`}>
                          <SelectValue placeholder="Choose a product" />
                        </SelectTrigger>
                        <SelectContent className="max-w-[420px]">
                          {products.map((p) => (
                            <SelectItem key={p.asin} value={p.asin} className="text-[13px]">
                              <span className="flex min-w-0 items-center gap-2">
                                <ProductThumb src={p.imageUrl} size={20} />
                                <span className="truncate">{p.title}</span>
                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{p.asin}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td>
                      <Input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} inputMode="numeric" placeholder="0" className="h-8 w-20 text-[13px]" aria-label="Quantity" />
                    </td>
                    <td>
                      <Input value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} inputMode="decimal" placeholder="0.00" className="h-8 w-24 text-[13px]" aria-label="Unit price" />
                    </td>
                    <td>
                      <Input value={l.miscCharges} onChange={(e) => update(l.key, { miscCharges: e.target.value })} inputMode="decimal" placeholder="0.00" className="h-8 w-24 text-[13px]" aria-label="Misc charges" />
                    </td>
                    <td>
                      <Input
                        value={l.totalPaid}
                        onChange={(e) => update(l.key, { totalPaid: e.target.value })}
                        inputMode="decimal"
                        placeholder={preview.perLine[i]?.paid ? preview.perLine[i].paid.toFixed(2) : "0.00"}
                        className="h-8 w-28 text-[13px]"
                        aria-label="Total paid"
                      />
                    </td>
                    <td className="text-right font-medium tabular-nums">{preview.perLine[i]?.qty ? money(preview.perLine[i].landed) : "—"}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blankLine()]))}
                        className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                        aria-label="Remove line"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            <Plus className="size-3.5" /> Add product
          </Button>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Field label="Amazon placement fee" hint="Shared by every unit in the shipment">
            <Input name="placementFee" value={placementFee} onChange={(e) => setPlacementFee(e.target.value)} inputMode="decimal" placeholder="0.00" className="h-8 text-[13px]" />
          </Field>
          <Field label="Other shipment costs" hint="Freight, inspection, duties… if not in Total paid">
            <Input name="otherCosts" value={otherCosts} onChange={(e) => setOtherCosts(e.target.value)} inputMode="decimal" placeholder="0.00" className="h-8 text-[13px]" />
          </Field>
          <Field label="Notes">
            <Input name="notes" defaultValue={shipment?.notes ?? ""} placeholder="Optional" className="h-8 text-[13px]" />
          </Field>
        </section>
      </div>

      <SheetFooter className="sticky bottom-0 flex-row items-center justify-between gap-3 border-t bg-popover px-6 py-3">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{preview.units.toLocaleString()}</span> units ·{" "}
          <span className="font-medium text-foreground tabular-nums">{money(preview.total)}</span> total
          {state?.error && <span className="ml-3 text-destructive">{state.error}</span>}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : shipment ? "Save changes" : "Add shipment"}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
