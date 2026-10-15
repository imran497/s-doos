import { signedPercent } from "@/lib/metrics";

/** A headline number with its change against the previous period. `goodWhenUp` colours the change. */
export function StatTile({ label, value, change, goodWhenUp = true, hint }: {
  label: string;
  value: React.ReactNode;
  change?: number | null;
  goodWhenUp?: boolean;
  hint?: string;
}) {
  const text = signedPercent(change);
  const good = change != null && (goodWhenUp ? change >= 0 : change <= 0);
  return (
    <div className="card p-5" title={hint}>
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-2xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {text && <p className={`mt-1 text-xs font-bold ${good ? "text-brand" : "text-coral"}`}>{text} vs previous period</p>}
    </div>
  );
}
