"use client";

import { useActionState, useEffect, useRef } from "react";
import { PencilLine, X } from "lucide-react";
import { addKeywords } from "@/app/actions";

export function AddKeywordsButton({ productId }: { productId: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addKeywords.bind(null, productId), undefined);

  useEffect(() => {
    if (state?.message) form.current?.reset();
  }, [state]);

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => dialog.current?.showModal()}>
        <PencilLine className="size-4" />
        Add keywords
      </button>
      <dialog ref={dialog} className="m-auto w-full max-w-lg rounded-3xl p-0 backdrop:bg-ink/50">
        <form ref={form} action={action} className="space-y-4 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">Add keywords</h2>
              <p className="text-sm text-muted-foreground">One per line, or separated by commas. Duplicates are skipped.</p>
            </div>
            <button type="button" aria-label="Close" className="cursor-pointer text-muted-foreground hover:text-ink" onClick={() => dialog.current?.close()}>
              <X className="size-5" />
            </button>
          </div>
          <textarea name="keywords" rows={10} autoFocus className="field" placeholder={"magnetic tiles for toddlers\nmagnet building toys"} />
          {state?.error && <p className="text-sm text-coral">{state.error}</p>}
          {state?.message && <p className="text-sm text-brand">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Done
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
