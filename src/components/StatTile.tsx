import { signedPercent } from "@/lib/metrics";
import { cn } from "@/lib/utils";

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
    <div className="rounded-lg border bg-card px-4 py-3.5 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]" title={hint}>
      <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {text && (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className={cn("font-medium", good ? "text-positive" : "text-destructive")}>{text}</span> vs previous period
        </p>
      )}
    </div>
  );
}
