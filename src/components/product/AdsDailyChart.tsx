"use client";

import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { formatValue } from "@/components/dashboard/format";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

export type AdsDay = {
  date: string;
  cost: number | null;
  sales: number | null;
  clicks: number | null;
  impressions: number | null;
  purchases: number | null;
  /** All orders that day: Amazon payout − cost of goods. */
  profit: number;
  /** profit − ad spend. */
  profitAfterAds: number;
};

const config = {
  sales: { label: "Ad sales", color: "var(--chart-1)" },
  cost: { label: "Ad spend", color: "var(--chart-2)" },
  profitAfterAds: { label: "Profit after ads", color: "var(--chart-5)" },
} satisfies ChartConfig;

const label = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Daily ad spend and profit after ads (bars), ad sales (line); hover a day for the full breakdown. */
export function AdsDailyChart({ days, currency }: { days: AdsDay[]; currency: string }) {
  const money = (n: number | null) => (n == null ? "—" : formatValue("money", n, currency));
  const data = days.map((d) => ({ ...d, label: label(d.date) }));
  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      {/* barGap 0: a day's spend and profit bars sit together; the gap is between days. */}
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={0} barSize={days.length > 20 ? 10 : 14}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={(v: number) => formatValue("money", v, currency, true)} />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as AdsDay & { label: string };
            const reported = d.cost != null || d.sales != null;
            const profitRows: [string, string][] = [
              ["Profit on sales", money(d.profit)],
              ["Profit after ads", money(d.profitAfterAds)],
            ];
            const rows: [string, string][] = reported
              ? [
                  ["Ad sales", money(d.sales)],
                  ["Ad spend", money(d.cost)],
                  ["ACoS", d.cost != null && d.sales ? `${((d.cost / d.sales) * 100).toFixed(1)}%` : "—"],
                  ["Orders", d.purchases == null ? "—" : d.purchases.toLocaleString()],
                  ["Clicks", d.clicks == null ? "—" : d.clicks.toLocaleString()],
                  ["Impressions", d.impressions == null ? "—" : d.impressions.toLocaleString()],
                  ["CPC", d.cost != null && d.clicks ? money(d.cost / d.clicks) : "—"],
                ]
              : [];
            return (
              <div className="min-w-44 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                <p className="mb-1.5 font-medium text-foreground">{new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                {profitRows.map(([k, v], i) => (
                  <div key={k} className="flex items-center justify-between gap-4 py-0.5">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {i === 1 && <span className="inline-block size-2 rounded-sm" style={{ background: d.profitAfterAds < 0 ? "var(--destructive)" : "var(--chart-5)" }} />}
                      {k}
                    </span>
                    <span className={`font-medium tabular-nums ${(i === 0 ? d.profit : d.profitAfterAds) < 0 ? "text-destructive" : "text-foreground"}`}>{v}</span>
                  </div>
                ))}
                <div className="my-1 border-t" />
                {reported ? (
                  rows.map(([k, v], i) => (
                    <div key={k} className="flex items-center justify-between gap-4 py-0.5">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        {i < 2 && <span className="inline-block size-2 rounded-sm" style={{ background: i === 0 ? "var(--chart-1)" : "var(--chart-2)" }} />}
                        {k}
                      </span>
                      <span className="font-medium tabular-nums text-foreground">{v}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">Ads not reported yet</p>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="cost" fill="var(--color-cost)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        {/* Profit after ads next to spend: green above zero, red below. */}
        <Bar dataKey="profitAfterAds" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.date} fill={d.profitAfterAds < 0 ? "var(--destructive)" : "var(--color-profitAfterAds)"} />
          ))}
        </Bar>
        <Line dataKey="sales" type="linear" stroke="var(--color-sales)" strokeWidth={2} dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    </ChartContainer>
  );
}
