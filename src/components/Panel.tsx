import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A card section: a header row (title, optional note and actions) and a body. */
export function Panel({ title, meta, actions, children, className, bodyClassName, id }: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Padding for the body; tables usually want none ("p-0"). */
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Standard table styles (header row, cells), shared by the plain tables. */
export const tableStyles = {
  table: "w-full text-[13px]",
  head: "bg-canvas text-xs text-muted-foreground [&_th]:px-4 [&_th]:py-2.5 [&_th]:font-medium [&_th]:whitespace-nowrap",
  row: "border-b last:border-0 [&>td]:px-4 [&>td]:py-2.5",
};
