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

/** Tiny rank trend for table rows. Rank 1 is at the top; the line is teal if it improved, coral if it fell. */
export function Sparkline({ series, delta }: { series: (number | null)[]; delta: number | null }) {
  const values = series.filter((v): v is number => v != null);
  if (values.length < 2) return <span className="text-xs text-muted-foreground">–</span>;
  const w = 96;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const step = w / (series.length - 1);
  const segments = paths(series, (i) => i * step, (v) => 3 + ((v - min) / (max - min)) * (h - 6));
  const color = delta == null || delta === 0 ? "var(--color-muted)" : delta > 0 ? "var(--color-brand)" : "var(--color-coral)";
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

const LINE_COLORS = ["var(--color-brand)", "var(--color-coral)", "#6c5ce7", "#e9a23b", "#2d9cdb", "#8a6d5a", "#b8509a"];

/** Several series on one chart (e.g. your BSR vs competitors'), with a legend. Lower is higher with `invert`. */
export function MultiLineChart({ series, labels, invert = false, format = String }: {
  series: { name: string; values: (number | null)[]; highlight?: boolean }[];
  labels: string[];
  invert?: boolean;
  format?: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!all.length) return <EmptyChart height="h-48" />;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step = labels.length > 1 ? W / (labels.length - 1) : W;
  const y = (v: number) => 10 + ((invert ? v - min : max - v) / (max - min)) * (H - 20);
  return (
    <div>
      <div className="flex gap-2">
        <div className="flex w-12 shrink-0 flex-col justify-between py-1 text-right text-[11px] tabular-nums text-muted-foreground">
          <span>{format(invert ? min : max)}</span>
          <span>{format(invert ? max : min)}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full min-w-0 flex-1 overflow-visible">
          {series.map((s, i) =>
            paths(s.values, (j) => j * step, y).map((seg, k) => (
              <path
                key={`${i}-${k}`}
                d={seg.d}
                fill="none"
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={s.highlight ? 3 : 1.75}
                strokeDasharray={s.highlight ? undefined : "4 3"}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            )),
          )}
          {labels.map((label, j) => (
            <rect key={label} x={j * step - step / 2} y={0} width={step} height={H} fill="transparent" className="hover:fill-black/5">
              <title>{`${label}\n${series.map((s) => `${s.name}: ${s.values[j] == null ? "–" : format(s.values[j]!)}`).join("\n")}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pl-14 text-xs">
        {series.map((s, i) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
            <span className={s.highlight ? "font-bold" : "text-muted-foreground"}>{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Simple bar chart (hourly or daily buckets). Hover a bar for its value. */
export function BarChart({ bars, format = String, color = "var(--color-brand)" }: {
  bars: { label: string; value: number }[];
  format?: (v: number) => string;
  color?: string;
}) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  if (!bars.length || max === 0) return <EmptyChart height="h-44" />;
  // Show at most ~8 axis labels so they don't overlap.
  const every = Math.max(1, Math.ceil(bars.length / 8));
  return (
    <div>
      <div className="flex h-44 items-end gap-[3px]">
        {bars.map((b) => (
          <div key={b.label} className="group relative flex h-full flex-1 items-end" title={`${b.label}: ${format(b.value)}`}>
            <div className="w-full rounded-t-md transition group-hover:opacity-80" style={{ height: `${Math.max((b.value / max) * 100, b.value ? 2 : 0)}%`, background: color }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3px] text-[10px] text-muted-foreground">
        {bars.map((b, i) => (
          <span key={b.label} className="flex-1 overflow-visible whitespace-nowrap text-center">
            {i % every === 0 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
