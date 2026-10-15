"use client";

import { useState, useTransition } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { MoreHorizontal, Plus, RefreshCw, Search } from "lucide-react";
import { deleteExpense, syncExpensesNow, type ActionState } from "@/app/actions";
import { formatValue } from "@/components/dashboard/format";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Expense, ExpensesData } from "@/lib/expenses";
import { GROUP_LABELS, type CategoryInfo, type ExpenseGroup } from "@/lib/expenses-meta";
import { cn } from "@/lib/utils";
import { ExpenseForm, type EditableExpense } from "./ExpenseForm";

const money = (n: number) => formatValue("money", n, "USD");
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const GROUP_COLORS: Record<ExpenseGroup, string> = { amazon: "var(--chart-1)", advertising: "var(--chart-4)", own: "var(--chart-3)" };

export function ExpensesView({ data, startAdding = false }: { data: ExpensesData; startAdding?: boolean }) {
  const [editing, setEditing] = useState<EditableExpense | null>(null);
  const [formOpen, setFormOpen] = useState(startAdding);
  const [defaultCategory, setDefaultCategory] = useState<string | undefined>();
  const [filter, setFilter] = useState<"all" | ExpenseGroup>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();

  const info = new Map(data.categories.map((c) => [c.key, c]));
  const catOf = (key: string): CategoryInfo => info.get(key) ?? { key, name: key, group: "own", treatment: "cost", auto: false };
  const editable = data.categories.filter((c) => c.group !== "amazon");

  const add = (cat?: string) => {
    setEditing(null);
    setDefaultCategory(cat);
    setFormOpen(true);
  };
  const edit = (e: Expense) => {
    setEditing({ id: e.id, date: e.date, category: e.category, description: e.description, amount: e.amount, notes: e.notes });
    setFormOpen(true);
  };

  const visible = data.rows.filter((r) => {
    const c = catOf(r.category);
    if (filter !== "all" && c.group !== filter) return false;
    if (category && r.category !== category) return false;
    const q = query.trim().toLowerCase();
    return !q || r.description.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q);
  });

  const groups = (["amazon", "advertising", "own"] as const).map((g) => ({ group: g, items: data.perCategory.filter((c) => c.group === g) }));
  const maxCategory = Math.max(1, ...data.perCategory.filter((c) => c.treatment === "cost").map((c) => Math.abs(c.total)));
  const chartConfig = {
    amazon: { label: GROUP_LABELS.amazon, color: GROUP_COLORS.amazon },
    advertising: { label: GROUP_LABELS.advertising, color: GROUP_COLORS.advertising },
    own: { label: GROUP_LABELS.own, color: GROUP_COLORS.own },
  } satisfies ChartConfig;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Categories, Amazon first */}
        <section className="rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)] lg:col-span-2">
          <div className="border-b px-4 py-3">
            <h2 className="text-[13px] font-semibold">By category</h2>
          </div>
          <div className="divide-y">
            {groups.map(({ group, items }) => (
              <div key={group} className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <span className="size-2 rounded-sm" style={{ background: GROUP_COLORS[group] }} />
                    {GROUP_LABELS[group]}
                    {group === "amazon" && <span className="rounded bg-brand-soft px-1 py-px text-[10px] font-medium tracking-normal text-brand-dark normal-case">Automatic</span>}
                  </p>
                  {group !== "amazon" && (
                    <button type="button" onClick={() => add(group === "advertising" ? "advertising" : undefined)} className="text-xs font-medium text-brand hover:text-brand-dark">
                      + Add
                    </button>
                  )}
                </div>
                {items.length ? (
                  <ul className="space-y-1">
                    {items.map((c) => {
                      const excluded = c.treatment !== "cost";
                      const active = category === c.key;
                      return (
                        <li key={c.key}>
                          <button
                            type="button"
                            onClick={() => setCategory(active ? null : c.key)}
                            className={cn("w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-canvas", active && "bg-brand-soft hover:bg-brand-soft")}
                          >
                            <span className="flex items-baseline justify-between gap-3 text-[13px]">
                              <span className={cn("min-w-0 truncate", excluded && "text-muted-foreground")}>
                                {c.hint ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">{c.name}</span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-64">{c.hint}</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  c.name
                                )}
                                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{c.count || ""}</span>
                              </span>
                              <span className={cn("shrink-0 font-medium tabular-nums", excluded && "text-muted-foreground line-through decoration-muted-foreground/40", c.total < 0 && "text-positive")}>
                                {c.count ? money(c.total < 0 ? -c.total : c.total) : "—"}
                                {c.total < 0 && " back"}
                              </span>
                            </span>
                            {!excluded && c.total > 0 && (
                              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-canvas">
                                <span className="block h-full rounded-full" style={{ width: `${(c.total / maxCategory) * 100}%`, background: GROUP_COLORS[group] }} />
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-2 text-[13px] text-muted-foreground">{group === "amazon" ? "No Amazon charges in this period." : "Nothing yet."}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Monthly */}
        <section className="rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)] lg:col-span-3">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-[13px] font-semibold">By month</h2>
            <span className="flex gap-3 text-xs text-muted-foreground">
              {(["amazon", "advertising", "own"] as const).map((g) => (
                <span key={g} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: GROUP_COLORS[g] }} />
                  {GROUP_LABELS[g]}
                </span>
              ))}
            </span>
          </div>
          <div className="px-2 pt-4 pb-2">
            <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
              <BarChart data={data.monthly} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={(v: number) => formatValue("money", v, "USD", true)} />
                <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent formatter={(v, name) => <TooltipRow name={String(name)} value={Number(v)} />} />} />
                <Bar dataKey="amazon" stackId="a" fill="var(--color-amazon)" maxBarSize={36} isAnimationActive={false} />
                <Bar dataKey="advertising" stackId="a" fill="var(--color-advertising)" maxBarSize={36} isAnimationActive={false} />
                <Bar dataKey="own" stackId="a" fill="var(--color-own)" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </div>
        </section>
      </div>

      {/* Every charge */}
      <section className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)} variant="outline" size="sm">
              {(["all", "amazon", "advertising", "own"] as const).map((f) => (
                <ToggleGroupItem key={f} value={f} className="h-7 px-2.5 text-xs data-[state=on]:bg-brand-soft data-[state=on]:text-brand-dark">
                  {f === "all" ? "All" : GROUP_LABELS[f]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {category && (
              <button type="button" onClick={() => setCategory(null)} className="rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand-dark">
                {catOf(category).name} ✕
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search charges" className="h-8 pl-8 text-[13px]" />
            </div>
            <Button size="sm" onClick={() => add()}>
              <Plus className="size-3.5" /> Add charge
            </Button>
          </div>
        </div>
        <Table className={cn(pending && "opacity-60")}>
          <TableHeader>
            <TableRow className="bg-canvas hover:bg-canvas">
              <TableHead className="w-[120px] pl-4 text-xs">Date</TableHead>
              <TableHead className="text-xs">Description</TableHead>
              <TableHead className="text-xs">Category</TableHead>
              <TableHead className="text-xs">Source</TableHead>
              <TableHead className="text-right text-xs">Amount</TableHead>
              <TableHead className="w-10 pr-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const c = catOf(r.category);
              const excluded = c.treatment !== "cost";
              return (
                <TableRow key={r.id}>
                  <TableCell className="pl-4 text-[13px] tabular-nums">{day(r.date)}</TableCell>
                  <TableCell className="max-w-0 text-[13px]">
                    <span className="block truncate" title={r.notes ? `${r.description}: ${r.notes}` : r.description}>
                      {r.description}
                      {r.notes && <span className="ml-2 text-muted-foreground">{r.notes}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: GROUP_COLORS[c.group] }} />
                      {c.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", r.source === "spapi" ? "bg-brand-soft text-brand-dark" : "bg-[#f1f3f7] text-[#545969]")}>
                      {r.source === "spapi" ? "Amazon" : r.source === "sheet" ? "Sheet" : "Manual"}
                    </span>
                  </TableCell>
                  <TableCell className={cn("text-right text-[13px] font-medium tabular-nums", excluded && "text-muted-foreground", r.amount < 0 && "text-positive")}>
                    {excluded ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">({money(r.amount)})</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">Not counted: {c.hint}</TooltipContent>
                      </Tooltip>
                    ) : r.amount < 0 ? (
                      `+${money(-r.amount)}`
                    ) : (
                      money(r.amount)
                    )}
                  </TableCell>
                  <TableCell className="pr-2">
                    {r.source !== "spapi" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => edit(r)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => {
                              if (confirm(`Delete "${r.description}"?`)) start(async () => void (await deleteExpense(r.id)));
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!visible.length && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center text-[13px] text-muted-foreground">
                  No charges in this period{filter !== "all" || category || query ? " match" : ""}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <ExpenseForm open={formOpen} onOpenChange={setFormOpen} expense={editing} categories={editable} defaultCategory={defaultCategory} />
    </div>
  );
}

function TooltipRow({ name, value }: { name: string; value: number }) {
  const label = GROUP_LABELS[name as ExpenseGroup] ?? name;
  return (
    <span className="flex w-full items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2 rounded-sm" style={{ background: GROUP_COLORS[name as ExpenseGroup] }} />
        {label}
      </span>
      <span className="font-medium tabular-nums text-foreground">{money(value)}</span>
    </span>
  );
}

/** Re-reads Amazon account charges now. */
export function SyncExpensesButton({ lastSynced }: { lastSynced: string | null }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>();
  return (
    <div className="flex items-center gap-2">
      {state && <span className={cn("max-w-56 truncate text-xs", state.error ? "text-destructive" : "text-muted-foreground")}>{state.error ?? state.message}</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        title={lastSynced ? `Amazon charges last checked ${lastSynced}` : "Not checked yet"}
        onClick={() => start(async () => setState(await syncExpensesNow()))}
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} /> {pending ? "Checking Amazon…" : "Refresh from Amazon"}
      </Button>
    </div>
  );
}
