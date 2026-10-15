"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatValue } from "@/components/dashboard/format";
import { ProductThumb } from "@/components/ProductThumb";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProductRowData } from "@/lib/products-table";

type Filter = "all" | "active" | "inactive";

export function ProductsTable({ rows, periodLabel, initialOpen }: { rows: ProductRowData[]; periodLabel: string; initialOpen?: number }) {
  const [open, setOpen] = useState<Set<number>>(new Set(initialOpen ? [initialOpen] : []));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(
    () => ({ all: rows.length, active: rows.filter((r) => r.status === "Active").length, inactive: rows.filter((r) => r.status != null && r.status !== "Active").length }),
    [rows],
  );
  const visible = rows.filter((r) => {
    if (filter === "active" && r.status !== "Active") return false;
    if (filter === "inactive" && (r.status == null || r.status === "Active")) return false;
    const q = query.trim().toLowerCase();
    return !q || r.asin.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.skus.some((s) => s.sku.toLowerCase().includes(q));
  });
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} variant="outline" size="sm">
          {(["all", "active", "inactive"] as const).map((f) => (
            <ToggleGroupItem key={f} value={f} className="h-7 px-2.5 text-xs data-[state=on]:bg-brand-soft data-[state=on]:text-brand-dark">
              {f === "all" ? "All" : f === "active" ? "Active" : "Inactive"}
              <span className="ml-1 tabular-nums text-muted-foreground">{counts[f]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ASIN, SKU or title" className="h-8 pl-8 text-[13px]" />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="bg-canvas hover:bg-canvas">
            <TableHead className="w-[150px] pl-4 text-xs">ASIN</TableHead>
            <TableHead className="text-xs">Title</TableHead>
            <TableHead className="w-[110px] text-xs">Status</TableHead>
            <TableHead className="w-[130px] text-right text-xs">FBA inventory</TableHead>
            <TableHead className="w-[130px] pr-4 text-right text-xs">Price</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((r) => {
            const expanded = open.has(r.id);
            return (
              <Fragment key={r.id}>
                <TableRow className={cn("cursor-pointer", expanded && "border-b-0 bg-canvas/60")} onClick={() => toggle(r.id)} aria-expanded={expanded}>
                  <TableCell className="pl-2">
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={expanded ? "Hide details" : "Show details"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(r.id);
                        }}
                      >
                        <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
                      </button>
                      <span className="font-mono text-xs">{r.asin}</span>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <span className="flex items-center gap-3">
                      <ProductThumb src={r.imageUrl} size={32} />
                      <span className="truncate text-[13px] font-medium" title={r.title}>
                        {r.title}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.inventory ? (
                      <span className="flex flex-col items-end">
                        <span className="text-[13px] font-medium">{r.inventory.fulfillable.toLocaleString()}</span>
                        {r.inventory.inbound > 0 && <span className="text-[11px] text-muted-foreground">+{r.inventory.inbound.toLocaleString()} inbound</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{r.fba ? "0" : "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">
                    <Price row={r} />
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="bg-canvas/60 hover:bg-canvas/60">
                    <TableCell colSpan={5} className="px-4 pt-1 pb-4 whitespace-normal">
                      <Details row={r} periodLabel={periodLabel} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          {!visible.length && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-10 text-center text-[13px] text-muted-foreground">
                No products match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="text-xs text-muted-foreground" title="Waiting for Amazon's listings report">
        Checking…
      </span>
    );
  }
  const tone =
    status === "Active"
      ? "bg-positive-soft text-positive"
      : status === "Incomplete"
        ? "bg-[#fdf1dc] text-[#8a5a12]"
        : "bg-[#f1f3f7] text-[#545969]";
  const dot = status === "Active" ? "bg-positive" : status === "Incomplete" ? "bg-[#d4911f]" : "bg-[#a3acb9]";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium", tone)}>
      <span className={cn("size-1.5 rounded-full", dot)} />
      {status}
    </span>
  );
}

function Price({ row }: { row: ProductRowData }) {
  if (row.price == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end">
      <span className="text-[13px] font-medium">{formatValue("money", row.price, row.currency)}</span>
      {row.salePrice != null && row.regularPrice != null && (
        <span className="text-[11px] text-muted-foreground">
          <span className="line-through">{formatValue("money", row.regularPrice, row.currency)}</span>{" "}
          <span className="font-medium text-coral">−{Math.round((1 - row.salePrice / row.regularPrice) * 100)}%</span>
        </span>
      )}
    </span>
  );
}

// ---- Expanded row ----

type Stat = { label: string; value: string; hint?: string; tone?: "good" | "bad" };

function Details({ row: r, periodLabel }: { row: ProductRowData; periodLabel: string }) {
  const money = (n: number | null | undefined) => (n == null ? "—" : formatValue("money", n, r.currency));
  const pct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);
  const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
  const margin = r.netPerUnit != null && r.price ? r.netPerUnit / r.price : null;

  const groups: { title: string; note?: string; stats: Stat[] }[] = [
    {
      title: "Sales",
      note: periodLabel,
      stats: [
        { label: "Units sold", value: num(r.sales.units) },
        { label: "Orders", value: num(r.sales.orders) },
        { label: "Revenue", value: money(r.sales.revenue) },
        { label: "Avg. selling price", value: r.sales.units ? money(r.sales.revenue / r.sales.units) : "—" },
        { label: "Cost of goods", value: r.sales.cogs == null ? "—" : money(r.sales.cogs), hint: "Landed cost of the units sold, from your shipments (first-in, first-out)" },
        {
          label: "Est. profit",
          value: r.sales.profit == null ? "—" : money(r.sales.profit),
          hint: "Revenue − estimated Amazon fees − cost of goods − ad spend",
          tone: r.sales.profit == null ? undefined : r.sales.profit >= 0 ? "good" : "bad",
        },
      ],
    },
    {
      title: "Traffic",
      note: r.traffic ? periodLabel : "From the Sales & Traffic report, about 2 days behind",
      stats: [
        { label: "Sessions", value: num(r.traffic?.sessions) },
        { label: "Page views", value: num(r.traffic?.pageViews) },
        { label: "Conversion", value: pct(r.traffic?.conversion), hint: "Units ordered ÷ sessions" },
        { label: "Buy Box", value: r.traffic?.buyBoxPct == null ? (r.buyBox?.yours == null ? "—" : r.buyBox.yours ? "Yours" : "Lost") : `${r.traffic.buyBoxPct.toFixed(0)}%`, hint: "Share of page views where you held the Buy Box" },
      ],
    },
    {
      title: "Price & fees",
      note: "Per unit at today's price",
      stats: [
        { label: "Sale price", value: r.salePrice == null ? "No sale" : money(r.salePrice), hint: r.salePrice == null ? undefined : `Regular ${money(r.regularPrice)}` },
        {
          label: "Landed cost",
          value: money(r.unitCost),
          hint: r.costRef ? `From shipment ${r.costRef}: what you paid per unit plus its share of shipment costs` : r.unitCost != null ? "Entered by hand on the product" : "Add a shipment to know your cost per unit",
        },
        { label: "Referral fee", value: money(r.fees.referral) },
        { label: "FBA fee", value: money(r.fees.fba) },
        { label: "Total fees", value: money(r.fees.total) },
        {
          label: r.unitCost != null ? "Profit per unit" : "After fees",
          value: money(r.netPerUnit),
          hint: r.unitCost != null ? `After fees and ${money(r.unitCost)} landed cost (${pct(margin, 0)} margin)` : `Before your product cost (${pct(margin, 0)} of price). Add a shipment to include it.`,
          tone: r.netPerUnit == null ? undefined : r.netPerUnit > 0 ? "good" : "bad",
        },
      ],
    },
    {
      title: "Promotions & ads",
      note: periodLabel,
      stats: [
        {
          label: "Orders with a promotion",
          value: num(r.sales.promoOrders),
          hint: r.sales.promoIds.length ? `Coupons, deals and other promotions applied: ${r.sales.promoIds.join(", ")}` : "Coupons, deals and other promotions applied at checkout",
        },
        { label: "Promotion discounts", value: money(r.sales.promoDiscount) },
        { label: "Ad spend", value: r.ads ? money(r.ads.spend) : "Not connected" },
        { label: "ACoS", value: r.ads ? pct(r.ads.acos) : "—", hint: "Ad spend ÷ ad sales" },
        { label: "TACoS", value: r.ads ? pct(r.ads.tacos) : "—", hint: "Ad spend ÷ all sales" },
      ],
    },
    {
      title: "Inventory",
      note: r.inventory ? `as of ${r.inventory.date}` : undefined,
      stats: [
        { label: "Available", value: num(r.inventory?.fulfillable) },
        { label: "Inbound", value: num(r.inventory?.inbound) },
        { label: "Reserved", value: num(r.inventory?.reserved) },
        { label: "Unsellable", value: num(r.inventory?.unfulfillable) },
        {
          label: "Days of cover",
          value: r.daysOfCover == null ? "—" : `${r.daysOfCover} days`,
          hint: "Available stock at the last 30 days' sales pace",
          tone: r.daysOfCover == null ? undefined : r.daysOfCover < 21 ? "bad" : undefined,
        },
      ],
    },
  ];

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-5">
        {groups.map((g) => (
          <div key={g.title} className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{g.title}</p>
            {g.note && <p className="truncate text-[11px] text-muted-foreground" title={g.note}>{g.note}</p>}
            <dl className="mt-2 space-y-1.5">
              {g.stats.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <dt className="text-muted-foreground">
                    {s.hint ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">{s.label}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">{s.hint}</TooltipContent>
                      </Tooltip>
                    ) : (
                      s.label
                    )}
                  </dt>
                  <dd className={cn("font-medium tabular-nums", s.tone === "good" && "text-positive", s.tone === "bad" && "text-destructive")}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {r.bsr && (
            <span>
              BSR <span className="font-medium text-foreground tabular-nums">#{r.bsr.rank.toLocaleString()}</span> in {r.bsr.category}
            </span>
          )}
          {r.skus.length > 0 && (
            <span>
              SKU{r.skus.length > 1 ? "s" : ""}{" "}
              {r.skus.map((s, i) => (
                <span key={s.sku}>
                  {i > 0 && ", "}
                  <span className="font-mono text-foreground">{s.sku}</span> ({s.fba ? "FBA" : "FBM"}
                  {s.status !== "Active" ? `, ${s.status.toLowerCase()}` : ""})
                </span>
              ))}
            </span>
          )}
          {r.openDate && <span>Listed {r.openDate.slice(0, 10)}</span>}
        </span>
        <Link href={`/products/${r.id}`} className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-dark">
          Open product <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
