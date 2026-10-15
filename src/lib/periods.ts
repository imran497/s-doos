// Date ranges for the dashboard's duration picker, each with the matching earlier range to compare
// against ("Today so far" vs yesterday up to the same time, "Last 7 days" vs the 7 days before, …).
// Times are the computer's local time zone.

export const PERIODS = [
  { key: "today", label: "Today so far" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_7", label: "Last 7 days" },
  { key: "this_month", label: "This month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
  { key: "last_6m", label: "Last 6 months" },
  { key: "last_12m", label: "Last 12 months" },
  { key: "custom", label: "Custom" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];
export type Granularity = "hour" | "day" | "week" | "month";

export type Period = {
  key: PeriodKey;
  label: string;
  start: Date;
  /** Exclusive. */
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  /** e.g. "vs yesterday at this time" */
  compareLabel: string;
  /** Short name of the comparison period, e.g. "Yesterday" (chart tooltips). */
  previousLabel: string;
  granularity: Granularity;
  /** Chart buckets: [start, end) pairs covering the period. */
  buckets: { start: Date; end: Date; label: string }[];
  /** YYYY-MM-DD values for the custom range inputs. */
  from: string;
  to: string;
};

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
const addMonths = (d: Date, n: number) => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
};
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s: string | undefined) => {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export const isPeriodKey = (k: string | undefined): k is PeriodKey => PERIODS.some((p) => p.key === k);

/** Resolves a duration choice (plus custom from/to dates) into exact ranges. */
export function resolvePeriod(key: PeriodKey, fromParam?: string, toParam?: string, now = new Date()): Period {
  const today = startOfDay(now);
  let start: Date;
  let end: Date = now;
  let prevStart: Date;
  let prevEnd: Date;
  let compareLabel: string;

  switch (key) {
    case "today":
      start = today;
      prevStart = addDays(today, -1);
      prevEnd = addDays(now, -1);
      compareLabel = "vs yesterday at this time";
      break;
    case "yesterday":
      start = addDays(today, -1);
      end = today;
      prevStart = addDays(today, -2);
      prevEnd = start;
      compareLabel = "vs the day before";
      break;
    case "this_week": {
      // Weeks start on Sunday, like Amazon's weekly reports.
      start = addDays(today, -today.getDay());
      prevStart = addDays(start, -7);
      prevEnd = addDays(now, -7);
      compareLabel = "vs the same days last week";
      break;
    }
    case "this_month":
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      prevStart = addMonths(start, -1);
      prevEnd = addMonths(now, -1);
      compareLabel = "vs the same days last month";
      break;
    case "last_6m":
    case "last_12m": {
      const months = key === "last_6m" ? 6 : 12;
      start = addMonths(addDays(today, 1), -months);
      prevStart = addMonths(start, -months);
      prevEnd = start;
      compareLabel = `vs the ${months} months before`;
      break;
    }
    case "custom": {
      const from = parseYmd(fromParam) ?? addDays(today, -6);
      const to = parseYmd(toParam) ?? today;
      start = from <= to ? from : to;
      const last = from <= to ? to : from;
      end = new Date(Math.min(addDays(last, 1).getTime(), now.getTime()));
      const length = end.getTime() - start.getTime();
      prevEnd = start;
      prevStart = new Date(start.getTime() - length);
      compareLabel = "vs the same length before";
      break;
    }
    default: {
      // last_7 / last_30 / last_90: the last N days including today so far.
      const days = key === "last_7" ? 7 : key === "last_30" ? 30 : 90;
      start = addDays(today, -(days - 1));
      prevStart = addDays(start, -days);
      prevEnd = start;
      compareLabel = `vs the ${days} days before`;
    }
  }

  const spanDays = (end.getTime() - start.getTime()) / DAY;
  const granularity: Granularity = spanDays <= 1.01 ? "hour" : spanDays <= 45 ? "day" : spanDays <= 200 ? "week" : "month";
  const label = PERIODS.find((p) => p.key === key)!.label;
  const previousLabel =
    {
      today: "Yesterday",
      yesterday: "Day before",
      this_week: "Last week",
      this_month: "Last month",
      last_7: "Previous 7 days",
      last_30: "Previous 30 days",
      last_90: "Previous 90 days",
      last_6m: "Previous 6 months",
      last_12m: "Previous 12 months",
      custom: "Previous period",
    }[key];
  return {
    key,
    label,
    start,
    end,
    prevStart,
    prevEnd,
    compareLabel,
    previousLabel,
    granularity,
    buckets: buckets(start, end, granularity),
    from: ymd(start),
    to: ymd(addDays(end, end.getHours() === 0 && end.getMinutes() === 0 ? -1 : 0)),
  };
}

function buckets(start: Date, end: Date, g: Granularity) {
  const out: { start: Date; end: Date; label: string }[] = [];
  const step = (d: Date) =>
    g === "hour" ? new Date(d.getTime() + 3_600_000) : g === "day" ? addDays(d, 1) : g === "week" ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const fmt = (d: Date) =>
    g === "hour"
      ? d.toLocaleTimeString("en-US", { hour: "numeric" })
      : g === "month"
        ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  for (let s = start; s < end; ) {
    const next = step(s);
    out.push({ start: s, end: next < end ? next : end, label: fmt(s) });
    s = next;
  }
  return out;
}
