import { bands, NOT_FOUND_COLOR, type BandKey } from "@/lib/insights";

type Point = { label: string; value: number | null };

const W = 400;
const H = 120;

/** Break a series into continuous runs, skipping days with no data. */
function paths(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  const segments: { d: string; x0: number }[] = [];
  let current: string[] = [];
  let x0 = 0;
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push({ d: current.join(" "), x0 });
      current = [];
      return;
    }
    if (!current.length) x0 = x(i);
    current.push(`${current.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length) segments.push({ d: current.join(" "), x0 });
  return segments;
}

/** Area/line chart. With `invert`, lower values sit higher (rank 1 at the top). Hover a day for its value. */
export function LineChart({ points, invert = false, color = "var(--color-brand)", format = String, height = "h-36" }: {
  points: Point[];
  invert?: boolean;
  color?: string;
  format?: (v: number) => string;
  height?: string;
}) {
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!values.length) return <EmptyChart height={height} />;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const y = (v: number) => 10 + ((invert ? v - min : max - v) / (max - min)) * (H - 20);
  const segments = paths(points.map((p) => p.value), (i) => i * step, y);

  return (
    <div className="flex gap-2">
      <div className="flex w-10 shrink-0 flex-col justify-between py-1 text-right text-[11px] tabular-nums text-muted-foreground">
        <span>{format(invert ? min : max)}</span>
        <span>{format(invert ? max : min)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`${height} w-full min-w-0 flex-1 overflow-visible`}>
        {segments.map((s, i) => (
          <g key={i}>
            <path d={`${s.d} V${H} H${s.x0} Z`} fill={color} opacity={0.1} />
            <path d={s.d} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {points.map((p, i) => (
          <rect key={p.label} x={i * step - step / 2} y={0} width={step} height={H} fill="transparent" className="hover:fill-black/5">
            <title>{`${p.label}: ${p.value == null ? "no data" : format(p.value)}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/** Tiny rank trend for table rows. Rank 1 is at the top; the line is green if it improved, red if it fell. */
export function Sparkline({ series, delta }: { series: (number | null)[]; delta: number | null }) {
  const values = series.filter((v): v is number => v != null);
  if (values.length < 2) return <span className="text-xs text-muted-foreground">–</span>;
  const w = 96;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const step = w / (series.length - 1);
  const segments = paths(series, (i) => i * step, (v) => 3 + ((v - min) / (max - min)) * (h - 6));
  const color = delta == null || delta === 0 ? "var(--muted-foreground)" : delta > 0 ? "var(--color-positive)" : "var(--destructive)";
  const lastIndex = series.findLastIndex((v) => v != null);
  return (
    <svg width={w} height={h} viewBox={`-2 0 ${w + 4} ${h}`} aria-hidden="true">
      {segments.map((s, i) =>
        s.d.includes("L") ? (
          <path key={i} d={s.d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        ) : (
          // A day with no checked neighbours: show it as a dot rather than an invisible line.
          <circle key={i} cx={Number(s.d.slice(1).split(",")[0])} cy={Number(s.d.split(",")[1])} r={1.6} fill={color} />
        ),
      )}
      <circle cx={lastIndex * step} cy={3 + ((series[lastIndex]! - min) / (max - min)) * (h - 6)} r={2.5} fill={color} />
    </svg>
  );
}

/** One stacked column per day: how many keywords sat in each rank band. */
export function BandHistory({ days }: { days: { date: string; bands: Record<BandKey, number> }[] }) {
  const order: { key: BandKey; color: string; label: string }[] = [
    ...bands.map((b) => ({ key: b.key as BandKey, color: b.color, label: b.label })),
    { key: "none", color: NOT_FOUND_COLOR, label: "Not found" },
  ];
  const totals = days.map((d) => Object.values(d.bands).reduce((a, b) => a + b, 0));
  if (!totals.some(Boolean)) return <EmptyChart height="h-36" />;
  return (
    <div className="flex h-36 items-end gap-1">
      {days.map((d, i) => (
        <div
          key={d.date}
          title={`${d.date}\n${order.map((b) => `${b.label}: ${d.bands[b.key]}`).join("\n")}`}
          className="flex h-full flex-1 flex-col overflow-hidden rounded-md bg-canvas"
        >
          {totals[i] > 0 &&
            order.map((b) => <div key={b.key} style={{ height: `${(d.bands[b.key] / totals[i]) * 100}%`, background: b.color }} />)}
        </div>
      ))}
    </div>
  );
}

function EmptyChart({ height }: { height: string }) {
  return <div className={`grid ${height} place-items-center rounded-2xl bg-canvas text-sm text-muted-foreground`}>No data yet</div>;
}
