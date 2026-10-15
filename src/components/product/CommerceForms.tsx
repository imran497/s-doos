"use client";

import { useActionState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { addCompetitor, removeCompetitor, trackKeyword, updateUnitCost, watchCompetitor } from "@/app/actions";

export function UnitCostForm({ productId, unitCost, currency }: { productId: number; unitCost: number | null; currency: string }) {
  const [state, action, pending] = useActionState(updateUnitCost.bind(null, productId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-sm">
        <span className="font-semibold">Cost per unit ({currency})</span>
        <input name="unitCost" type="number" step="0.01" min="0" defaultValue={unitCost ?? ""} placeholder="e.g. 6.40" className="field w-36" />
      </label>
      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state && <span className={`pb-2 text-xs ${state.error ? "text-coral" : "text-brand"}`}>{state.error ?? state.message}</span>}
    </form>
  );
}

export function AddCompetitorForm({ productId }: { productId: number }) {
  const [state, action, pending] = useActionState(addCompetitor.bind(null, productId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="min-w-64 flex-1 space-y-1 text-sm">
        <span className="font-semibold">Competitor ASINs</span>
        <input name="asins" placeholder="B07XYZ1234, B08ABC5678" className="field font-mono uppercase" />
      </label>
      <button className="btn-primary" disabled={pending}>
        <Plus className="size-4" /> {pending ? "Adding…" : "Watch"}
      </button>
      {state && <p className={`w-full text-xs ${state.error ? "text-coral" : "text-brand"}`}>{state.error ?? state.message}</p>}
    </form>
  );
}

export function RemoveCompetitorButton({ competitorId }: { competitorId: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Stop watching"
      title="Stop watching"
      disabled={pending}
      onClick={() => start(() => removeCompetitor(competitorId))}
      className="cursor-pointer rounded-full p-1 text-muted-foreground hover:bg-coral-soft hover:text-coral"
    >
      <X className="size-4" />
    </button>
  );
}

/** For Research: track a search term on one of your products, or watch a clicked ASIN as a competitor. */
export function ResearchActions({ term, products, competitorAsins }: {
  term: string;
  products: { id: number; asin: string; title: string | null }[];
  competitorAsins: string[];
}) {
  const [pending, start] = useTransition();
  if (!products.length) return null;
  const pick = (label: string, run: (productId: number) => Promise<void>) =>
    products.length === 1 ? (
      <button type="button" className="btn py-1 text-xs" disabled={pending} onClick={() => start(() => run(products[0].id))}>
        {label}
      </button>
    ) : (
      <select
        className="field w-auto py-1 text-xs"
        disabled={pending}
        defaultValue=""
        onChange={(e) => {
          const id = Number(e.currentTarget.value);
          if (id) start(() => run(id));
          e.currentTarget.value = "";
        }}
      >
        <option value="" disabled>
          {label}…
        </option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {(p.title ?? p.asin).slice(0, 40)}
          </option>
        ))}
      </select>
    );
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {pick("+ Track", (id) => trackKeyword(id, term))}
      {competitorAsins.length > 0 &&
        pick(`Watch ${competitorAsins.length === 1 ? "rival" : `${competitorAsins.length} rivals`}`, async (id) => {
          for (const asin of competitorAsins) await watchCompetitor(id, asin);
        })}
    </div>
  );
}

