"use client";

import { useActionState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { addProduct } from "@/app/actions";
import { marketplaces } from "@/lib/marketplaces";

/** "Track a product" button that opens the add-product form in a dialog. */
export function AddProductButton({ variant = "button" }: { variant?: "button" | "tile" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The menu's "Track a product" links to /?add=1. Only the tile (always on the page) opens it, so it opens once.
  const requested = useSearchParams().get("add") === "1";
  useEffect(() => {
    if (requested && variant === "tile" && !dialog.current?.open) dialog.current?.showModal();
  }, [requested, variant]);
  return (
    <>
      {variant === "tile" ? (
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="grid min-h-64 cursor-pointer place-items-center rounded-3xl border-2 border-dashed border-line text-muted-foreground transition hover:border-brand hover:text-brand"
        >
          <span className="flex flex-col items-center gap-2 font-semibold">
            <span className="grid size-11 place-items-center rounded-full bg-white shadow-sm">
              <Plus className="size-5" />
            </span>
            Track a product
          </span>
        </button>
      ) : (
        <button type="button" className="btn-primary" onClick={() => dialog.current?.showModal()}>
          <Plus className="size-4" /> Track a product
        </button>
      )}
      <dialog ref={dialog} className="m-auto w-full max-w-lg rounded-3xl p-0 backdrop:bg-ink/50">
        <AddProductForm onClose={() => dialog.current?.close()} />
      </dialog>
    </>
  );
}

function AddProductForm({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(addProduct, undefined);
  return (
    <form action={action} className="space-y-5 p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Track a product</h2>
          <p className="text-sm text-muted-foreground">Add an ASIN and the searches you want to win.</p>
        </div>
        <button type="button" aria-label="Close" className="cursor-pointer text-muted-foreground hover:text-ink" onClick={onClose}>
          <X className="size-5" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_190px]">
        <label className="space-y-1.5 text-sm">
          <span className="font-semibold">ASIN</span>
          <input name="asin" required placeholder="B0GZ8LVLGR" className="field font-mono uppercase" maxLength={10} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-semibold">Marketplace</span>
          <select name="marketplace" defaultValue="US" className="field">
            {Object.entries(marketplaces).map(([code, m]) => (
              <option key={code} value={code}>
                {m.flag} {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-semibold">Keywords</span>
        <textarea name="keywords" rows={7} placeholder={"magnetic tiles\nmagnetic building blocks\nstem toys for 3 year olds"} className="field" />
        <span className="text-xs text-muted-foreground">One per line, or separated by commas. You can add more later.</span>
      </label>
      {state?.error && <p className="text-sm font-medium text-coral">{state.error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Adding…" : "Start tracking"}
        </button>
      </div>
    </form>
  );
}
