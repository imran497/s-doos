"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DateRange } from "react-day-picker";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERIODS, type PeriodKey } from "@/lib/periods";

const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const short = (s: string) => parse(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Marketplace switch and date range picker (presets + calendar). Choices live in the URL. */
export function DashboardControls({ period, from, to, marketplace, marketplaceOptions }: {
  period: PeriodKey;
  from: string;
  to: string;
  marketplace: string;
  marketplaceOptions: { code: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>({ from: parse(from), to: parse(to) });

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next}`, { scroll: false });
  };

  const label = PERIODS.find((p) => p.key === period)?.label ?? "Custom";
  const span = from === to ? short(from) : `${short(from)} – ${short(to)}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {marketplaceOptions.length > 1 && (
        <Select value={marketplace} onValueChange={(m) => go({ m })}>
          <SelectTrigger size="sm" className="h-8 w-auto gap-2 text-[13px] font-medium" aria-label="Marketplace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {marketplaceOptions.map((m) => (
              <SelectItem key={m.code} value={m.code} className="text-[13px]">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-2 text-[13px] font-medium">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            {label}
            <span className="font-normal text-muted-foreground">{span}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <div className="flex flex-col sm:flex-row">
            <ul className="flex flex-row flex-wrap gap-0.5 border-b p-2 sm:w-44 sm:flex-col sm:border-r sm:border-b-0">
              {PERIODS.filter((p) => p.key !== "custom").map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      go({ period: p.key, from: null, to: null });
                    }}
                    className={cn(
                      "flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] hover:bg-accent",
                      period === p.key && "font-medium text-primary",
                    )}
                  >
                    {p.label}
                    {period === p.key && <Check className="size-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="p-2">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={range}
                onSelect={setRange}
                defaultMonth={range?.from}
                disabled={{ after: new Date() }}
              />
              <div className="flex items-center justify-between gap-3 border-t px-2 pt-2">
                <span className="text-xs text-muted-foreground">
                  {range?.from ? `${range.from.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${range.to ? range.to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "…"}` : "Pick a start date"}
                </span>
                <Button
                  size="sm"
                  disabled={!range?.from}
                  onClick={() => {
                    if (!range?.from) return;
                    setOpen(false);
                    go({ period: "custom", from: ymd(range.from), to: ymd(range.to ?? range.from) });
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
