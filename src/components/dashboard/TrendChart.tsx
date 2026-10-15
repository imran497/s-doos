"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatValue, type ValueKind } from "./format";

export type TrendPoint = { label: string; current: number | null; previous: number | null };

/**
 * Current period as an indigo area, previous period as a dashed grey line.
 * Hover shows both values for that point.
 */
export function TrendChart({ data, kind, currency, height = 220, previousLabel = "Previous period" }: {
  data: TrendPoint[];
  kind: ValueKind;
  currency?: string;
  height?: number;
  previousLabel?: string;
}) {
  const gradientId = `fill-${useId().replace(/:/g, "")}`;
  const hasPrevious = data.some((d) => d.previous != null);
  // A value with no neighbours has no line to draw, so mark it with a dot.
  const isolated = (i: number) => data[i]?.current != null && data[i - 1]?.current == null && data[i + 1]?.current == null;
  const config = {
    current: { label: "This period", color: "var(--chart-1)" },
    previous: { label: previousLabel, color: "var(--chart-2)" },
  } satisfies ChartConfig;

  if (!data.some((d) => d.current)) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed text-[13px] text-muted-foreground" style={{ height }}>
        No activity in this period
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-current)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-current)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="0" stroke="var(--border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          fontSize={11}
          tickFormatter={(v: number) => formatValue(kind, v, currency, true)}
          allowDecimals={kind !== "number"}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as TrendPoint;
            return (
              <div className="min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                <p className="mb-1.5 font-medium text-foreground">{label}</p>
                <Row color="var(--chart-1)" name="This period" value={formatValue(kind, point.current, currency)} />
                {hasPrevious && <Row color="var(--chart-2)" name={previousLabel} value={formatValue(kind, point.previous, currency)} dashed />}
              </div>
            );
          }}
        />
        {hasPrevious && (
          <Line dataKey="previous" type="linear" stroke="var(--color-previous)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls />
        )}
        <Area dataKey="current" type="linear" stroke="var(--color-current)" strokeWidth={2} fill={`url(#${gradientId})`}
          dot={(p: { index: number; cx?: number; cy?: number }) =>
            isolated(p.index) ? <circle key={p.index} cx={p.cx} cy={p.cy} r={3} fill="var(--color-current)" /> : <g key={p.index} />
          } activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ChartContainer>
  );
}

function Row({ color, name, value, dashed }: { color: string; name: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="inline-block h-0.5 w-3 rounded" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)` : color }} />
        {name}
      </span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
