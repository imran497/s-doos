"use client";

import { Fragment, useState, useTransition } from "react";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { deleteShipment, setShipmentStatus } from "@/app/actions";
import { formatValue } from "@/components/dashboard/format";
import { ProductThumb } from "@/components/ProductThumb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShipmentStatus } from "@/lib/cogs-math";
import type { ProductOption, Shipment } from "@/lib/shipments";
import { cn } from "@/lib/utils";
import { ShipmentForm } from "./ShipmentForm";
import { ShipmentView } from "./ShipmentView";
import { todayInAppZone } from "@/lib/timezone";

const money = (n: number) => formatValue("money", n, "USD");
const date = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const today = () => todayInAppZone();

export function ShipmentsTable({ shipments, nextRef, products, startAdding = false, startViewing }: {
  shipments: Shipment[];
  nextRef: string;
  products: ProductOption[];
  /** Open the add form right away (/shipments?add=1). */
  startAdding?: boolean;
  /** Open one shipment's details right away (/shipments?view=KB_001). */
  startViewing?: string;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set(shipments.slice(0, 1).map((s) => s.id)));
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [formOpen, setFormOpen] = useState(startAdding);
  const [viewing, setViewing] = useState<number | null>(() => shipments.find((x) => x.ref === startViewing)?.id ?? null);
  const [pending, start] = useTransition();

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const edit = (s: Shipment | null) => {
    setViewing(null);
    setEditing(s);
    setFormOpen(true);
  };
  const setStatus = (s: Shipment, status: ShipmentStatus) => start(async () => void (await setShipmentStatus(s.id, status, status === "arrived" ? today() : undefined)));

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <p className="text-[13px] text-muted-foreground">
          {shipments.length} shipment{shipments.length === 1 ? "" : "s"} · costs are matched to sales first-in, first-out
        </p>
        <Button size="sm" onClick={() => edit(null)}>
          <Plus className="size-3.5" /> Add shipment
        </Button>
      </div>

      {shipments.length ? (
        <Table className={cn(pending && "opacity-60")}>
          <TableHeader>
            <TableRow className="bg-canvas hover:bg-canvas">
              <TableHead className="w-[140px] pl-4 text-xs">Reference</TableHead>
              <TableHead className="text-xs">Supplier</TableHead>
              <TableHead className="text-xs">Ordered</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-right text-xs">Units</TableHead>
              <TableHead className="text-right text-xs">Total cost</TableHead>
              <TableHead className="text-right text-xs">Avg cost / unit</TableHead>
              <TableHead className="w-10 pr-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s) => {
              const expanded = open.has(s.id);
              return (
                <Fragment key={s.id}>
                  <TableRow className={cn("cursor-pointer", expanded && "border-b-0 bg-canvas/60")} onClick={() => toggle(s.id)} aria-expanded={expanded}>
                    <TableCell className="pl-2">
                      <span className="flex items-center gap-1">
                        <span className="grid size-6 place-items-center text-muted-foreground">
                          <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
                        </span>
                        <button
                          type="button"
                          className="text-[13px] font-medium text-brand hover:text-brand-dark hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewing(s.id);
                          }}
                        >
                          {s.ref}
                        </button>
                      </span>
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{s.supplier || "—"}</TableCell>
                    <TableCell className="text-[13px] tabular-nums">{date(s.orderDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} arrived={s.arrivedDate} />
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{s.units.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium tabular-nums">{money(s.totalCost)}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{s.units ? money(s.totalCost / s.units) : "—"}</TableCell>
                    <TableCell className="pr-2" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${s.ref}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => setViewing(s.id)}>View</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => edit(s)}>Edit</DropdownMenuItem>
                          {s.status !== "arrived" && <DropdownMenuItem onSelect={() => setStatus(s, "arrived")}>Mark arrived today</DropdownMenuItem>}
                          {s.status === "ordered" && <DropdownMenuItem onSelect={() => setStatus(s, "in_transit")}>Mark in transit</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => {
                              if (confirm(`Delete ${s.ref}? Its products' cost of goods will be recalculated without it.`)) start(async () => void (await deleteShipment(s.id)));
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="bg-canvas/60 hover:bg-canvas/60">
                      <TableCell colSpan={8} className="px-4 pt-1 pb-4 whitespace-normal">
                        <Lines shipment={s} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <div className="px-6 py-14 text-center">
          <p className="text-[15px] font-semibold">No shipments yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
            Add what you bought and sent to Amazon. SellerDoos uses it as your cost of goods for profit.
          </p>
          <Button size="sm" className="mt-4" onClick={() => edit(null)}>
            <Plus className="size-3.5" /> Add shipment
          </Button>
        </div>
      )}

      <ShipmentView
        shipment={shipments.find((x) => x.id === viewing) ?? null}
        open={viewing != null}
        onOpenChange={(o) => !o && setViewing(null)}
        onEdit={edit}
      />
      <ShipmentForm open={formOpen} onOpenChange={setFormOpen} shipment={editing} nextRef={nextRef} products={products} />
    </div>
  );
}

function Lines({ shipment: s }: { shipment: Shipment }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
            <th className="text-left">Product</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Unit price</th>
            <th className="text-right">Misc</th>
            <th className="text-right">Total paid</th>
            <th className="text-right" title="Placement fee and other shipment costs, per unit">Shared / unit</th>
            <th className="text-right">Cost / unit</th>
            <th className="text-right">Sold</th>
            <th className="text-right">Left</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.id} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2">
              <td>
                <span className="flex min-w-0 items-center gap-2">
                  <ProductThumb src={l.imageUrl} size={24} />
                  <span className="min-w-0">
                    <span className="block max-w-[280px] truncate font-medium" title={l.title}>
                      {l.title}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{l.asin}</span>
                  </span>
                </span>
              </td>
              <td className="text-right tabular-nums">{l.qty.toLocaleString()}</td>
              <td className="text-right tabular-nums">{l.unitPrice ? money(l.unitPrice) : "—"}</td>
              <td className="text-right tabular-nums">{l.miscCharges ? money(l.miscCharges) : "—"}</td>
              <td className="text-right tabular-nums">{money(l.totalPaid)}</td>
              <td className="text-right tabular-nums text-muted-foreground">{money(l.sharedPerUnit)}</td>
              <td className="text-right font-semibold tabular-nums">{money(l.landedUnitCost)}</td>
              <td className="text-right tabular-nums">{l.sold.toLocaleString()}</td>
              <td className={cn("text-right tabular-nums", l.remaining === 0 && "text-muted-foreground")}>{l.remaining.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          Placement fee <span className="font-medium text-foreground tabular-nums">{money(s.placementFee)}</span>
        </span>
        {s.otherCosts > 0 && (
          <span>
            Other costs <span className="font-medium text-foreground tabular-nums">{money(s.otherCosts)}</span>
          </span>
        )}
        {s.arrivedDate && <span>Arrived {date(s.arrivedDate)}</span>}
        {s.notes && <span>{s.notes}</span>}
      </div>
    </div>
  );
}

function StatusBadge({ status, arrived }: { status: ShipmentStatus; arrived: string | null }) {
  const styles = {
    ordered: { tone: "bg-[#f1f3f7] text-[#545969]", dot: "bg-[#a3acb9]", label: "Ordered" },
    in_transit: { tone: "bg-[#fdf1dc] text-[#8a5a12]", dot: "bg-[#d4911f]", label: "In transit" },
    arrived: { tone: "bg-positive-soft text-positive", dot: "bg-positive", label: "Arrived" },
  }[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium", styles.tone)} title={arrived ? `Arrived ${arrived}` : undefined}>
      <span className={cn("size-1.5 rounded-full", styles.dot)} />
      {styles.label}
    </span>
  );
}
