"use client";

import { useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { deleteProduct, trackKeyword } from "@/app/actions";

export function DeleteProductButton({ productId }: { productId: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn text-coral"
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this product and all of its keyword, BSR and SQP history?")) start(() => deleteProduct(productId));
      }}
    >
      <Trash2 className="size-4" /> Delete
    </button>
  );
}

export function TrackButton({ productId, keyword }: { productId: number; keyword: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn py-1 text-xs" disabled={pending} onClick={() => start(() => trackKeyword(productId, keyword))}>
      <Plus className="size-3.5" /> Track
    </button>
  );
}
