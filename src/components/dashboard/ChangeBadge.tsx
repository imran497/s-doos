import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { change, formatValue, type ValueKind } from "./format";

/**
 * "+12.4%" pill in green or red, with the absolute difference next to it.
 * `better` = which direction is good news; "neutral" keeps it grey (e.g. ad spend).
 */
export function ChangeBadge({ current, previous, kind, currency, better = "up", showDelta = true }: {
  current: number | null;
  previous: number | null | undefined;
  kind: ValueKind;
  currency?: string;
  better?: "up" | "down" | "neutral";
  showDelta?: boolean;
}) {
  const c = change(current, previous);
  if (!c) return <span className="text-xs text-muted-foreground">No comparison</span>;
  const flat = Math.abs(c.delta) < 1e-9;
  const up = c.delta > 0;
  const good = better === "neutral" || flat ? null : up === (better === "up");
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
          good === true && "bg-positive-soft text-positive",
          good === false && "bg-coral-soft text-destructive",
          good === null && "bg-[#f1f3f7] text-[#545969]",
        )}
      >
        {!flat && <Icon className="size-3" />}
        {c.ratio == null ? "New" : `${up ? "+" : flat ? "" : "−"}${Math.abs(c.ratio * 100).toFixed(1)}%`}
      </span>
      {showDelta && !flat && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {up ? "+" : "−"}
          {formatValue(kind, Math.abs(c.delta), currency)}
        </span>
      )}
    </span>
  );
}
