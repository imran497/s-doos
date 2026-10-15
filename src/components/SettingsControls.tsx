"use client";

import { useActionState, useState, useTransition } from "react";
import { CloudDownload, Play, Trash2 } from "lucide-react";
import { clearDemoData, runDailyNow, syncAmazonNow, updateSettings, type ActionState } from "@/app/actions";
import type { Settings } from "@/lib/settings";

export function SettingsForm({ settings, provider, researchSeeds }: { settings: Settings; provider: string; researchSeeds: string }) {
  const [state, action, pending] = useActionState(updateSettings, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Daily check time</span>
        <select name="scheduleHour" defaultValue={settings.scheduleHour} className="field">
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              After {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">Server&apos;s local time. Runs once a day while SellerDoos is running.</span>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Search result pages to scan</span>
        <select name="serpPages" defaultValue={settings.serpPages} className="field">
          {[1, 2, 3, 4, 5, 7].map((n) => (
            <option key={n} value={n}>
              {n} page{n > 1 ? "s" : ""} (about top {n * 48} results)
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {provider === "dataforseo"
            ? "DataForSEO charges per 100 results: 1–2 pages is one charge per keyword a day, 3–4 pages is two."
            : "Each page is one API request per keyword, so 50 keywords × 2 pages is up to 100 requests a day. Scanning stops early once the product is found."}
        </span>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Low-stock warning</span>
        <div className="flex items-center gap-2">
          <input name="lowStockDays" type="number" min={1} max={180} defaultValue={settings.lowStockDays} className="field w-24" />
          <span className="text-muted-foreground">days of stock left</span>
        </div>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Research seed words</span>
        <textarea name="researchSeeds" rows={2} defaultValue={researchSeeds} placeholder="e.g. montessori, sensory, stem" className="field" />
        <span className="text-xs text-muted-foreground">
          Top Search Terms keeps searches containing these words or words from your keywords. Keep it focused: the report has millions of terms.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Pulls everything from Amazon now (inventory, finances, prices, due reports). */
export function SyncAmazonButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>();
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setState(await syncAmazonNow()))}>
        <CloudDownload className={`size-4 ${pending ? "animate-pulse" : ""}`} /> {pending ? "Syncing… (up to a minute)" : "Sync Amazon data"}
      </button>
      {state && <p className={`max-w-md text-right text-xs ${state.error ? "text-coral" : "text-brand"}`}>{state.error ?? state.message}</p>}
    </div>
  );
}

export function RunButtons({ isDemo }: { isDemo: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>();
  const run = (fn: () => Promise<ActionState>) => start(async () => setState(await fn()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <button type="button" className="btn" disabled={pending} onClick={() => run(runDailyNow)}>
          <Play className="size-4" /> Run daily check now
        </button>
        <SyncAmazonButton />
        {isDemo && (
          <button
            type="button"
            className="btn text-coral"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete all sample (demo) data? Real data from Amazon is kept.")) run(async () => (await clearDemoData(), { message: "Demo data cleared." }));
            }}
          >
            <Trash2 className="size-4" /> Clear demo data
          </button>
        )}
      </div>
      {pending ? <p className="text-sm text-muted-foreground">Working… this can take a while with many keywords.</p> : <Result state={state} />}
    </div>
  );
}

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return <p className={`text-sm ${state.error ? "text-coral" : "text-brand"}`}>{state.error ?? state.message}</p>;
}
