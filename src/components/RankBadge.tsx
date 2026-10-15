import { bandOf } from "@/lib/insights";

const styles: Record<ReturnType<typeof bandOf>, string> = {
  top3: "bg-brand text-white",
  page1: "bg-brand-soft text-brand-dark",
  page2: "bg-[#fdf1dc] text-[#8a5a12]",
  beyond: "bg-coral-soft text-[#b4402f]",
  none: "bg-canvas text-muted-foreground",
};

/** A rank as a coloured pill: teal on page 1, sand on page 2, coral beyond. */
export function RankBadge({ rank, checked = true, size = "md" }: { rank: number | null; checked?: boolean; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "min-w-9 px-1.5 py-0.5 text-[11px]" : "min-w-12 px-2.5 py-1 text-sm";
  if (!checked) return <span className={`inline-block rounded-full text-center text-muted-foreground/60 ${pad}`}>·</span>;
  return (
    <span className={`inline-block rounded-full text-center font-bold tabular-nums ${styles[bandOf(rank)]} ${pad}`}>
      {rank == null ? "–" : `#${rank}`}
    </span>
  );
}
