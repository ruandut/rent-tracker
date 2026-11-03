import { cn } from "@/lib/utils";

// Full class strings so Tailwind sees them at build time.
export const TAG_COLORS = {
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  lime: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
} as const;

export const TAG_SWATCH: Record<keyof typeof TAG_COLORS, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  lime: "bg-lime-500",
  orange: "bg-orange-500",
  teal: "bg-teal-500",
  fuchsia: "bg-fuchsia-500",
};

export type TagColor = keyof typeof TAG_COLORS;

export const colorClass = (color: string) => TAG_COLORS[color as TagColor] ?? TAG_COLORS.slate;
export const swatchClass = (color: string) => TAG_SWATCH[color as TagColor] ?? TAG_SWATCH.slate;

export function TagPill({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap",
        colorClass(color),
        className,
      )}
    >
      {name}
    </span>
  );
}
