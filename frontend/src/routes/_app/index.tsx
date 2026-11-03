import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";

import { EmptyState, Page, Stat } from "@/components/page";
import { swatchClass } from "@/components/tag-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TransactionTable } from "@/features/transactions/transaction-table";
import { useFiltered } from "@/lib/api";
import { formatMoney, formatMonth } from "@/lib/format";
import { PAYMENT_METHOD_KINDS, type Dashboard } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data } = useFiltered<Dashboard>("/api/dashboard/", "dashboard");

  if (!data) {
    return (
      <Page title="Dashboard">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </Page>
    );
  }

  const monthName = formatMonth(data.month.start);
  return (
    <Page title="Dashboard" description="Where the rental money is, and where it went.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Account balance"
          value={formatMoney(data.balance)}
          icon={<Wallet className="size-4" />}
          hint={
            data.accounts.length > 1
              ? data.accounts.map((a) => `${a.name}: ${formatMoney(a.balance)}`).join(" · ")
              : "All active payment methods"
          }
        />
        <Stat
          label={`In · ${monthName}`}
          value={formatMoney(data.month.income)}
          tone="in"
          icon={<ArrowDownLeft className="size-4" />}
          hint="Money received this month"
        />
        <Stat
          label={`Out · ${monthName}`}
          value={formatMoney(data.month.expense)}
          tone="out"
          icon={<ArrowUpRight className="size-4" />}
          hint={`Net ${formatMoney(data.month.net)} this month`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border p-4 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">In vs out per month</h3>
            <p className="text-sm text-muted-foreground">
              Selected period:{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {formatMoney(data.range.income)}
              </span>
              {" in · "}
              <span className="text-rose-600 dark:text-rose-400">
                {formatMoney(data.range.expense)}
              </span>
              {" out · net "}
              <span className="font-medium text-foreground">{formatMoney(data.range.net)}</span>
            </p>
          </div>
          <MonthlyBars rows={data.monthly} />
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-4 font-medium">Spending by tag</h3>
          {data.by_tag.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tagged expenses in this period.</p>
          ) : (
            <TagBreakdown rows={data.by_tag} />
          )}
        </section>
      </div>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Recent activity</h3>
          <Button variant="outline" size="sm" asChild>
            <Link to="/transactions">View all</Link>
          </Button>
        </div>
        {data.recent.length === 0 ? (
          <EmptyState title="Nothing in this period">
            Log income or an expense to get started.
          </EmptyState>
        ) : (
          <TransactionTable rows={data.recent} compact />
        )}
      </section>

      {data.accounts.length === 0 && (
        <EmptyState title="No payment methods yet">
          Add your rental bank account under{" "}
          <Link to="/payment-methods" className="underline">
            Payment methods
          </Link>{" "}
          ({Object.values(PAYMENT_METHOD_KINDS).slice(0, 2).join(", ").toLowerCase()}…).
        </EmptyState>
      )}
    </Page>
  );
}

/** Paired bars per month, scaled to the biggest value in view. Plain divs: no chart library. */
function MonthlyBars({ rows }: { rows: Dashboard["monthly"] }) {
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No transactions in this period.</p>;
  const max = Math.max(...rows.flatMap((r) => [r.income, r.expense]), 1);
  return (
    <div className="grid gap-3">
      <div className="flex h-48 items-end gap-2 overflow-x-auto pb-1">
        {rows.map((row) => (
          <div key={row.month} className="flex min-w-10 flex-1 flex-col items-center gap-1">
            <div className="flex h-40 w-full items-end justify-center gap-0.5">
              <Bar
                value={row.income}
                max={max}
                className="bg-emerald-500"
                label={`In ${formatMoney(row.income)}`}
              />
              <Bar
                value={row.expense}
                max={max}
                className="bg-rose-500"
                label={`Out ${formatMoney(row.expense)}`}
              />
            </div>
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">
              {formatMonth(row.month).replace(" 20", " '")}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> In
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-rose-500" /> Out
        </span>
      </div>
    </div>
  );
}

function Bar({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number;
  className: string;
  label: string;
}) {
  return (
    <div
      title={label}
      className={cn("w-full max-w-4 rounded-t-sm transition-[height]", className)}
      style={{ height: `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%` }}
    />
  );
}

function TagBreakdown({ rows }: { rows: Dashboard["by_tag"] }) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <ul className="grid gap-3">
      {rows.map((row) => (
        <li key={row.id} className="grid gap-1">
          <div className="flex justify-between text-sm">
            <span>{row.name}</span>
            <span className="tabular-nums text-muted-foreground">{formatMoney(row.total)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", swatchClass(row.color))}
              style={{ width: `${(row.total / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
