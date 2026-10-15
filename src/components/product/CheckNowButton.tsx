"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { checkNow, type ActionState } from "@/app/actions";

export function CheckNowButton({ productId }: { productId: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>();
  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className={`max-w-sm truncate text-sm ${result.error ? "text-coral" : "text-brand"}`} title={result.error ?? result.message}>
          {result.error ?? result.message}
        </span>
      )}
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() => start(async () => setResult(await checkNow(productId)))}
      >
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Checking…" : "Check now"}
      </button>
    </div>
  );
}
