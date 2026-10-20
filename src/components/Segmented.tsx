import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A row of linked options, one active (e.g. Organic | Sponsored). Choices live in the URL. */
export function Segmented({ options, label }: { options: { href: string; label: ReactNode; active: boolean }[]; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border bg-card text-xs font-medium shadow-[0_1px_1px_0_rgba(16,24,40,0.04)]">
      {options.map((o, i) => (
        <Link
          key={i}
          href={o.href}
          scroll={false}
          aria-current={o.active ? "true" : undefined}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 px-2.5 transition-colors [&_svg]:size-3.5",
            i > 0 && "border-l",
            o.active ? "bg-brand-soft text-brand-dark" : "text-muted-foreground hover:bg-canvas hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
