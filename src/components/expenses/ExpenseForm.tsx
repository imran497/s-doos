"use client";

import { useActionState, useEffect, useState } from "react";
import { saveExpense } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CategoryInfo } from "@/lib/expenses-meta";

export type EditableExpense = { id: number; date: string; category: string; description: string; amount: number; notes: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Side panel to add or edit a charge you entered yourself. */
export function ExpenseForm({ open, onOpenChange, expense, categories, defaultCategory }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: EditableExpense | null;
  /** Categories you can file under: advertising and your own. */
  categories: CategoryInfo[];
  defaultCategory?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {open && <Body key={expense?.id ?? "new"} expense={expense} categories={categories} defaultCategory={defaultCategory} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ expense, categories, defaultCategory, onDone }: { expense: EditableExpense | null; categories: CategoryInfo[]; defaultCategory?: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveExpense, undefined);
  const [category, setCategory] = useState(expense?.category ?? defaultCategory ?? categories.find((c) => c.group === "own")?.key ?? "other");

  useEffect(() => {
    if (state?.message) onDone();
  }, [state, onDone]);

  const own = categories.filter((c) => c.group === "own");
  const ads = categories.filter((c) => c.group === "advertising");

  return (
    <form action={action} className="flex min-h-full flex-col">
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle className="text-base">{expense ? "Edit charge" : "Add charge"}</SheetTitle>
        <SheetDescription className="text-[13px]">For costs Amazon doesn&apos;t report: tools, samples, trademark, ads paid by card…</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 px-6 py-5">
        {expense && <input type="hidden" name="id" value={expense.id} />}
        <input type="hidden" name="category" value={category} />
        <Field label="Category">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger size="sm" className="h-8 w-full text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="text-[11px]">Your costs</SelectLabel>
                {own.map((c) => (
                  <SelectItem key={c.key} value={c.key} className="text-[13px]">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[11px]">Amazon</SelectLabel>
                {ads.map((c) => (
                  <SelectItem key={c.key} value={c.key} className="text-[13px]">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectItem value="__new" className="text-[13px] text-brand">
                + New category…
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {category === "__new" && (
          <Field label="New category name">
            <Input name="newCategory" placeholder="e.g. Photography" autoFocus className="h-8 text-[13px]" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">
            <Input name="date" type="date" defaultValue={expense?.date ?? today()} required className="h-8 text-[13px]" />
          </Field>
          <Field label="Amount (USD)">
            <Input name="amount" inputMode="decimal" defaultValue={expense ? String(expense.amount) : ""} placeholder="0.00" required className="h-8 text-[13px]" />
          </Field>
        </div>
        <Field label="What for">
          <Input name="description" defaultValue={expense?.description ?? ""} placeholder="e.g. Helium10 monthly" required className="h-8 text-[13px]" />
        </Field>
        <Field label="Notes">
          <Input name="notes" defaultValue={expense?.notes ?? ""} placeholder="Optional" className="h-8 text-[13px]" />
        </Field>
      </div>
      <SheetFooter className="sticky bottom-0 flex-row items-center justify-between gap-3 border-t bg-popover px-6 py-3">
        <p className="text-[13px] text-destructive">{state?.error}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : expense ? "Save" : "Add charge"}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
