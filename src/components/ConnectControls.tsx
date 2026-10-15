"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Unplug } from "lucide-react";
import { acknowledgeSecurity, disconnect, saveCredentials, testSellerConnection } from "@/app/actions";
import type { CredentialGroup } from "@/lib/credentials";

export type Field = {
  name: string;
  label: string;
  secret?: boolean;
  /** Masked hint of the saved value, e.g. ••••a1b2. */
  saved?: string;
  /** Set from an environment variable, so it can't be edited here. */
  locked?: boolean;
  placeholder?: string;
};

export function CredentialForm({ group, fields, draft }: { group: CredentialGroup; fields: Field[]; draft?: boolean }) {
  const [state, action, pending] = useActionState(saveCredentials.bind(null, group), undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="space-y-1 text-sm">
            <span className="font-semibold">{f.label}</span>
            <input
              name={f.name}
              type={f.secret ? "password" : "text"}
              autoComplete={f.secret ? "new-password" : "off"}
              data-1p-ignore
              data-lpignore="true"
              disabled={f.locked}
              placeholder={f.locked ? "Set in .env.local" : f.saved ? `Saved ${f.saved}` : f.placeholder}
              className="field font-mono text-xs"
            />
          </label>
        ))}
      </div>
      {draft !== undefined && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="SPAPI_DRAFT" defaultChecked={draft} className="mt-1 accent-[var(--color-brand)]" />
          <span>My app is still in Draft (needed until Amazon publishes it)</span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save keys"}
        </button>
        {state && <span className={`text-xs ${state.error ? "text-coral" : "text-brand"}`}>{state.error ?? state.message}</span>}
      </div>
      {fields.some((f) => f.saved) && <p className="text-xs text-muted-foreground">Leave a field blank to keep what&apos;s saved.</p>}
    </form>
  );
}

export function DisconnectButton({ group, label = "Disconnect" }: { group: CredentialGroup; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn text-coral"
      disabled={pending}
      onClick={() => {
        if (confirm("Disconnect? SellerDoos stops syncing this until you connect again. Data already saved is kept.")) start(() => disconnect(group));
      }}
    >
      <Unplug className="size-4" /> {label}
    </button>
  );
}

/** A value to paste into Amazon's developer console, with a copy button. */
export function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <button
        type="button"
        aria-label="Copy"
        className="cursor-pointer text-muted-foreground hover:text-ink"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4" />}
      </button>
    </span>
  );
}

export function AcknowledgeSecurityButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn" disabled={pending} onClick={() => start(() => acknowledgeSecurity())}>
      <Check className="size-4" /> I&apos;ve reviewed these
    </button>
  );
}

export function TestConnectionButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; message?: string }>();
  return (
    <div className="space-y-2">
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setState(await testSellerConnection()))}>
        {pending ? "Asking Amazon…" : "Test connection"}
      </button>
      {state && <p className={`text-sm ${state.error ? "text-coral" : "text-brand-dark"}`}>{state.error ?? state.message}</p>}
    </div>
  );
}
