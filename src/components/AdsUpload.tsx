"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdsUploadResult } from "@/lib/ads-upload";

const KIND = { products: "Advertised product", searchTerms: "Search term" } as const;

/** Upload Sponsored Products reports from the Amazon Ads console instead of connecting the Ads API. */
export function AdsUpload({ marketplaces }: { marketplaces: { code: string; label: string }[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [marketplace, setMarketplace] = useState(marketplaces[0]?.code ?? "US");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported?: AdsUploadResult[]; errors?: string[]; error?: string } | null>(null);

  async function upload() {
    setBusy(true);
    setResult(null);
    const body = new FormData();
    body.set("marketplace", marketplace);
    for (const f of files) body.append("files", f);
    const res = await fetch("/api/ads/upload", { method: "POST", body }).catch(() => null);
    setResult(res ? await res.json().catch(() => ({ error: "Unexpected response." })) : { error: "Couldn't reach SellerDoos." });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted-foreground">
        <li>
          In <b className="text-foreground">Campaign Manager</b> (advertising.amazon.com, or Seller Central → Advertising), open{" "}
          <b className="text-foreground">Measurement &amp; reporting → Sponsored ads reports → Create report</b>.
        </li>
        <li>
          Ad product <b className="text-foreground">Sponsored Products</b>, report type <b className="text-foreground">Advertised product</b>, time unit{" "}
          <b className="text-foreground">Daily</b>, any period (e.g. last 60 days), format .xlsx or .csv. <b className="text-foreground">Run report</b>, then download it.
        </li>
        <li>
          Optional: do the same with report type <b className="text-foreground">Search term</b> to see what shoppers typed.
        </li>
        <li>Upload the files here. Re-uploading days you already sent replaces them, so overlapping periods are fine.</li>
      </ol>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {marketplaces.length > 1 && (
            <select value={marketplace} onChange={(e) => setMarketplace(e.target.value)} className="field w-auto" aria-label="Marketplace">
              {marketplaces.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          <input
            type="file"
            multiple
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block min-w-0 flex-1 text-xs file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
        </div>
        <Button size="sm" disabled={!files.length || busy} onClick={upload}>
          <Upload className="size-3.5" /> {busy ? "Importing…" : `Upload ${files.length > 1 ? `${files.length} reports` : "report"}`}
        </Button>
        {result?.error && <p className="text-xs text-destructive">{result.error}</p>}
        {result?.imported?.map((r) => (
          <p key={r.file} className="text-xs text-positive">
            ✓ {KIND[r.kind]} report: {r.days} days ({r.from} to {r.to}), {r.rows.toLocaleString()} rows, ${r.spend.toFixed(2)} spend
          </p>
        ))}
        {result?.errors?.map((e) => (
          <p key={e} className="text-xs text-destructive">
            {e}
          </p>
        ))}
      </div>
    </div>
  );
}
