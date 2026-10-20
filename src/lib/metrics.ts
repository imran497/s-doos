// Rank maths shared by pages, charts and CSV export.

/**
 * Rough share of clicks a result gets at a given position. Used only to weight the
 * visibility score, so the exact values matter less than the steep drop-off.
 */
export function clickShare(rank: number | null) {
  if (rank == null) return 0;
  if (rank <= 3) return [0.3, 0.18, 0.12][rank - 1];
  if (rank <= 10) return 0.08 - (rank - 4) * 0.008;
  if (rank <= 20) return 0.02;
  if (rank <= 48) return 0.008;
  if (rank <= 100) return 0.002;
  return 0;
}

/**
 * Visibility score, 0–100: how much of the available search traffic the product would capture,
 * relative to ranking #1 for every keyword. Keywords are weighted by search volume when known.
 */
export function visibilityScore(entries: { rank: number | null; volume: number | null }[]) {
  let got = 0;
  let max = 0;
  for (const e of entries) {
    const weight = e.volume ?? 1;
    got += weight * clickShare(e.rank);
    max += weight * clickShare(1);
  }
  return max ? Math.round((got / max) * 1000) / 10 : 0;
}

export const compact = (n: number | null | undefined) =>
  n == null ? "–" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  part == null || !whole ? "–" : `${((part / whole) * 100).toFixed(1)}%`;

/** Money with its currency symbol, e.g. $1,234.50. Falls back to a plain number without a currency. */
export const formatMoney = (n: number | null | undefined, currency = "USD", compactForm = false) => {
  if (n == null) return "–";
  if (!currency) return (Object.is(n, -0) ? 0 : n).toFixed(2);
  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    // No "-$0.00" for a zero cost shown as negative.
    signDisplay: "negative",
    ...(compactForm ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }),
  }).format(n);
};

/** A ratio (0–1) as a percentage. */
export const percent = (r: number | null | undefined, digits = 1) => (r == null ? "–" : `${(r * 100).toFixed(digits)}%`);

/** A change ratio as "+12%" / "−8%". */
export const signedPercent = (r: number | null | undefined) => {
  if (r == null) return null;
  const n = Math.round(r * 100);
  return n === 0 ? "0%" : `${n > 0 ? "+" : "−"}${Math.abs(n)}%`;
};
