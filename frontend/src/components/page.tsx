import type { ReactNode } from "react";

import { FilterBar } from "@/components/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A screen's body. The header above it shows the route's name; `filters` adds the filter bar. */
export function Page({
  description,
  actions,
  filters,
  children,
}: {
  description?: string;
  actions?: ReactNode;
  filters?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6">
      {(description || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {filters && <FilterBar />}
      {children}
    </div>
  );
}

/**
 * For a table's main text column: takes the row's spare width and ellipsizes. A table cell only
 * truncates with a max-width set, and max-w-0 with w-full means "whatever space is left".
 */
export const flexCell = "w-full max-w-0 truncate";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-2 rounded-xl border p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/** A labelled number tile. `tone` colours the value for money in (positive) or out (negative). */
export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "in" | "out";
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        {icon}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "in" && "text-emerald-600 dark:text-emerald-400",
          tone === "out" && "text-rose-600 dark:text-rose-400",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
