import type { ReactNode } from "react";

/** Page title row: title and short description on the left, actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Section title with optional small meta text on the right. */
export function SectionHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="flex items-center gap-3">
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        {actions}
      </div>
    </div>
  );
}
