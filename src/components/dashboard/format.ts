export type ValueKind = "number" | "money" | "percent";

/** Formats a metric value for display. `compact` shortens large numbers for chart axes ($12.4K). */
export function formatValue(kind: ValueKind, n: number | null | undefined, currency = "USD", compact = false) {
  if (n == null || Number.isNaN(n)) return "—";
  if (kind === "percent") return `${(n * 100).toFixed(1)}%`;
  if (kind === "money") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }).format(n);
}

/** Change from previous to current: ratio (0.12 = +12%) and absolute difference. */
export function change(current: number | null, previous: number | null | undefined) {
  if (current == null || previous == null) return null;
  return { ratio: previous ? (current - previous) / previous : null, delta: current - previous };
}
