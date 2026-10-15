"use client";

import { useState } from "react";
import { Area, AreaChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChangeBadge } from "./ChangeBadge";
import { formatValue, type ValueKind } from "./format";
import { TrendChart, type TrendPoint } from "./TrendChart";

export type Measure = {
  key: string;
  label: string;
  kind: ValueKind;
  current: number | null;
  /** undefined/null = no earlier data to compare. */
  previous: number | null | undefined;
  points: TrendPoint[];
  better?: "up" | "down" | "neutral";
};

/** A headline metric with a trend chart. Several measures add a dropdown in the top-right corner. */
export function MetricChartCard({ title, measures, currency, compareLabel, previousLabel }: {
  title: string;
  measures: Measure[];
  currency: string;
  compareLabel: string;
  previousLabel: string;
}) {
  const [key, setKey] = useState(measures[0].key);
  const m = measures.find((x) => x.key === key) ?? measures[0];
  return (
    <Card className="gap-0 py-0 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)] ring-0 border">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 pt-4 pb-0">
        <CardTitle className="text-[13px] font-medium text-muted-foreground">{title}</CardTitle>
        {measures.length > 1 && (
          <Select value={key} onValueChange={setKey}>
            <SelectTrigger size="sm" className="h-7 w-auto gap-1 rounded-md border border-line bg-white px-2 text-xs font-medium text-ink shadow-[0_1px_1px_0_rgba(16,24,40,0.04)] hover:bg-canvas" aria-label={`${title} measure`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {measures.map((x) => (
                <SelectItem key={x.key} value={x.key} className="text-[13px]">
                  {x.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="px-5 pt-1 pb-4">
        <p className="text-[28px] leading-9 font-semibold tracking-tight tabular-nums">{formatValue(m.kind, m.current, currency)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {m.previous == null ? (
            <span className="text-xs text-muted-foreground">No earlier data to compare</span>
          ) : (
            <>
              <ChangeBadge current={m.current} previous={m.previous} kind={m.kind} currency={currency} better={m.better} />
              <span className="text-xs text-muted-foreground">{compareLabel}</span>
            </>
          )}
        </div>
        <div className="mt-4 -ml-2">
          <TrendChart data={m.points} kind={m.kind} currency={currency} previousLabel={previousLabel} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Compact KPI: label, value, change and a small trend line. */
export function KpiCard({ label, kind, current, previous, points, currency, better = "up", hint }: {
  label: string;
  kind: ValueKind;
  current: number | null;
  previous: number | null | undefined;
  points: (number | null)[];
  currency: string;
  better?: "up" | "down" | "neutral";
  hint?: string;
}) {
  const series = points.map((v, i) => ({ i, v }));
  const showLine = points.filter((v) => v != null).length > 1;
  return (
    <Card className="gap-0 border py-0 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)] ring-0" title={hint}>
      <CardContent className="px-4 py-4">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{formatValue(kind, current, currency)}</p>
        <div className="mt-1.5 min-h-5">
          {previous == null ? (
            <span className="text-xs text-muted-foreground">No earlier data</span>
          ) : (
            <ChangeBadge current={current} previous={previous} kind={kind} currency={currency} better={better} showDelta={false} />
          )}
        </div>
        <div className="mt-3 h-9">
          {showLine && (
            <ChartContainer config={{ v: { label, color: "var(--chart-1)" } }} className="aspect-auto h-9 w-full">
              <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                <Area dataKey="v" type="linear" stroke="var(--color-v)" strokeWidth={1.5} fill="var(--color-v)" fillOpacity={0.08} dot={false} isAnimationActive={false} connectNulls={false} />
              </AreaChart>
            </ChartContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
