import { formatMoney } from "@/lib/format";
import type { TransactionKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/** An amount coloured by direction: green for money in, red (with a minus) for money out. */
export function Money({
  value,
  kind,
  className,
}: {
  value: number;
  kind?: TransactionKind;
  className?: string;
}) {
  const out = kind === "expense" || (kind === undefined && value < 0);
  return (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        kind === "income" && "text-emerald-600 dark:text-emerald-400",
        out && "text-rose-600 dark:text-rose-400",
        className,
      )}
    >
      {kind === "expense" ? "−" : ""}
      {formatMoney(kind ? Math.abs(value) : value)}
    </span>
  );
}
