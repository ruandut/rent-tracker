import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { EmptyState, Page, Stat, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useList } from "@/lib/api";
import { formatMoney, formatMonth, formatNumber } from "@/lib/format";
import type { BillService, BillSummary } from "@/lib/types";

export const Route = createFileRoute("/_app/bills/")({
  staticData: { title: "Municipal bills" },
  component: BillsPage,
});

const usageText = (services: Record<string, BillService>) =>
  Object.values(services)
    .filter((service) => service.usage !== null)
    .map((service) => `${formatNumber(service.usage ?? 0)} ${service.usage_unit}`.trim())
    .join(", ") || "—";

function BillsPage() {
  const { data: rows, isPending } = useList<BillSummary>("bills");
  const navigate = useNavigate();

  const total = rows?.reduce((sum, row) => sum + row.total, 0) ?? 0;
  const water =
    rows?.reduce(
      (sum, row) =>
        sum +
        Object.values(row.services)
          .filter((service) => service.destination === "water")
          .reduce((used, service) => used + (service.usage ?? 0), 0),
      0,
    ) ?? 0;
  // Bills on different templates can have different services, so the columns follow the rows.
  const shown = [...new Set(rows?.flatMap((row) => Object.keys(row.services)))];

  return (
    <Page
      filters
      description="Each bill, split by rental unit, line by line. Saving one fills in Water & electricity and Rates & taxes."
      actions={
        <Button asChild>
          <Link to="/bills/new">
            <Plus /> Log bill
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Total billed"
          value={formatMoney(total)}
          tone="out"
          hint={`${rows?.length ?? 0} ${rows?.length === 1 ? "bill" : "bills"}, including VAT`}
        />
        <Stat
          label="Average per bill"
          value={formatMoney(rows?.length ? total / rows.length : 0)}
        />
        <Stat label="Water used" value={`${formatNumber(water)} kL`} />
      </div>

      {isPending && !rows ? (
        <TableSkeleton />
      ) : rows?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Units</TableHead>
                {shown.map((category) => (
                  <TableHead key={category} className="hidden text-right lg:table-cell">
                    {category}
                  </TableHead>
                ))}
                <TableHead className="text-right">Usage</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() =>
                    void navigate({ to: "/bills/$billId", params: { billId: String(row.id) } })
                  }
                >
                  <TableCell>{formatMonth(row.period)}</TableCell>
                  <TableCell className="max-w-24 truncate sm:max-w-40">
                    {row.units.map((unit) => unit.rental_unit_name).join(", ")}
                  </TableCell>
                  {shown.map((category) => (
                    <TableCell
                      key={category}
                      className="hidden text-right tabular-nums lg:table-cell"
                    >
                      {row.services[category] ? formatMoney(row.services[category].total) : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">
                    {usageText(row.services)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(row.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No bills in this period">
          Use Log bill to enter one, with the bill open next to the form.
        </EmptyState>
      )}
    </Page>
  );
}
