"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { addProduct } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { marketplaces } from "@/lib/marketplaces";

/** "Track a product" button that opens the add-product form in a side panel. */
export function AddProductButton({ variant = "button" }: { variant?: "button" | "tile" }) {
  // The menu's "Track a product" links to ?add=1. Only the tile (always on the page) opens it, so it opens once.
  const requested = useSearchParams().get("add") === "1" && variant === "tile";
  const [open, setOpen] = useState(requested);
  return (
    <>
      {variant === "tile" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid min-h-40 cursor-pointer place-items-center rounded-lg border border-dashed bg-card text-[13px] text-muted-foreground transition hover:border-brand hover:text-brand"
        >
          <span className="flex flex-col items-center gap-2 font-medium">
            <span className="grid size-9 place-items-center rounded-full border bg-card">
              <Plus className="size-4" />
            </span>
            Track a product
          </span>
        </button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Track a product
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          {open && <AddProductForm onClose={() => setOpen(false)} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function AddProductForm({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(addProduct, undefined);
  return (
    <form action={action} className="flex min-h-full flex-col">
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle className="text-base">Track a product</SheetTitle>
        <SheetDescription className="text-[13px]">Add an ASIN and the searches you want to win.</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
          <Field label="ASIN">
            <Input name="asin" required placeholder="B0GZ8LVLGR" className="h-8 font-mono text-[13px] uppercase" maxLength={10} />
          </Field>
          <Field label="Marketplace">
            <select
              name="marketplace"
              defaultValue="US"
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {Object.entries(marketplaces).map(([code, m]) => (
                <option key={code} value={code}>
                  {m.flag} {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Keywords">
          <textarea
            name="keywords"
            rows={8}
            placeholder={"magnetic tiles\nmagnetic building blocks\nstem toys for 3 year olds"}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-[13px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <span className="block text-xs text-muted-foreground">One per line, or separated by commas. You can add more later.</span>
        </Field>
      </div>
      <SheetFooter className="sticky bottom-0 flex-row items-center justify-between gap-3 border-t bg-popover px-6 py-3">
        <p className="text-[13px] text-destructive">{state?.error}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Start tracking"}
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
