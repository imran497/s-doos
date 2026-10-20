"use client";

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { compact } from "@/lib/metrics";

export type RankSeries = { name: string; values: (number | null)[]; you?: boolean };

const COLORS = ["var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#9aa3b5", "#c58af9", "#f5a524"];

/** Best Sellers Rank per day, one line per ASIN, on a log scale. Rank 1 is at the top; hover shows every rank that day. */
export function RankChart({ labels, series, height = 240 }: { labels: string[]; series: RankSeries[]; height?: number }) {
  const keys = series.map((_, i) => `s${i}`);
  let other = 0;
  const colors = series.map((s) => (s.you ? "var(--chart-1)" : COLORS[other++ % COLORS.length]));
  const config = Object.fromEntries(series.map((s, i) => [keys[i], { label: s.name, color: colors[i] }])) satisfies ChartConfig;
  const data = labels.map((label, d) => Object.fromEntries([["label", label], ...series.map((s, i) => [keys[i], s.values[d] ?? null])]));

  // Ranks span orders of magnitude (#200 next to #200,000), so the axis is logarithmic with ticks at 1, 10, 100…
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null && v > 0);
  const lo = 10 ** Math.floor(Math.log10(Math.min(...all, 1e9)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...all, 1) + 1));
  const domain = [lo, hi];
  const ticks = Array.from({ length: Math.round(Math.log10(hi / lo)) + 1 }, (_, i) => lo * 10 ** i);

  if (!all.length) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed text-[13px] text-muted-foreground" style={{ height }}>
        No rank data in this period
      </div>
    );
  }

  return (
    <div>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} fontSize={11} />
          <YAxis
            reversed
            scale="log"
            domain={domain}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            width={52}
            fontSize={11}
            tickFormatter={(v: number) => `#${compact(v)}`}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as Record<string, number | null>;
              return (
                <div className="min-w-48 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                  <p className="mb-1.5 font-medium text-foreground">{label}</p>
                  {series.map((s, i) => (
                    <div key={keys[i]} className="flex items-center justify-between gap-4 py-0.5">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: colors[i] }} />
                        <span className={s.you ? "font-medium text-foreground" : "truncate"}>{s.name}</span>
                      </span>
                      <span className="font-medium tabular-nums text-foreground">{point[keys[i]] == null ? "—" : `#${point[keys[i]]!.toLocaleString()}`}</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          {series.map((s, i) => (
            <Line
              key={keys[i]}
              dataKey={keys[i]}
              type="linear"
              stroke={colors[i]}
              strokeWidth={s.you ? 2.25 : 1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <span key={keys[i]} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: colors[i] }} />
            <span className={s.you ? "font-medium text-foreground" : ""}>{s.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
