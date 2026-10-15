"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Settings → Data: download a full backup, or replace everything with an uploaded one. */
export function DataControls() {
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);

  async function restore() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    const body = new FormData();
    body.set("file", file);
    const res = await fetch("/api/data/restore", { method: "POST", body }).catch(() => null);
    setResult(res ? await res.json().catch(() => ({ error: "Unexpected response." })) : { error: "Couldn't reach SellerDoos." });
    setBusy(false);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-2">
        <p className="text-[13px] font-semibold">Download a backup</p>
        <p className="text-xs text-muted-foreground">
          One file with everything: products, shipments, misc charges, Amazon history and your encrypted connections. Keep it somewhere safe.
        </p>
        <Button asChild variant="outline" size="sm">
          <a href="/api/data/backup">
            <Download className="size-3.5" /> Download backup
          </a>
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-semibold">Restore from a backup</p>
        <p className="text-xs text-muted-foreground">
          Replaces <b>all</b> current data with the file, e.g. <code className="font-mono">data/sellerdoos.db</code> from your computer when moving
          SellerDoos to a server. Its Amazon connections only work if this server uses the same encryption key.
        </p>
        <input
          type="file"
          accept=".db,.sqlite,application/vnd.sqlite3,application/octet-stream"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I understand this replaces all current data
        </label>
        <Button size="sm" variant="outline" disabled={!file || !confirmed || busy} onClick={restore}>
          <Upload className="size-3.5" /> {busy ? "Uploading…" : "Restore"}
        </Button>
        {result && <p className={`text-xs ${result.error ? "text-destructive" : "text-positive"}`}>{result.error ?? result.message}</p>}
      </div>
    </div>
  );
}
