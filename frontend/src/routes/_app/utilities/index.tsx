import { createFileRoute } from "@tanstack/react-router";
import { Droplets, Plus, Zap } from "lucide-react";
import { useState } from "react";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field, NativeSelect } from "@/components/form";
import { EmptyState, Page, Stat, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAll, useList, useRemove, useSave } from "@/lib/api";
import { formatMoney, formatMonth, formatNumber, thisMonth } from "@/lib/format";
import { UTILITY_KINDS, type RentalUnit, type UtilityKind, type UtilityReading } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFilters } from "@/stores/filters";

export const Route = createFileRoute("/_app/utilities/")({
  component: UtilitiesPage,
});

type Form = {
  rental_unit: string;
  kind: UtilityKind;
  month: string;
  meter_reading: string;
  usage: string;
  cost: string;
  notes: string;
};

const toForm = (row?: UtilityReading): Form => ({
  rental_unit: row ? String(row.rental_unit) : "",
  kind: row?.kind ?? "water",
  month: row ? row.period.slice(0, 7) : thisMonth(),
  meter_reading: row?.meter_reading != null ? String(row.meter_reading) : "",
  usage: row ? String(row.usage) : "",
  cost: row?.cost != null ? String(row.cost) : "",
  notes: row?.notes ?? "",
});

const numOrNull = (value: string) => (value === "" ? null : value);

function UtilitiesPage() {
  const [kind, setKind] = useState<UtilityKind>("water");
  const { data: rows, isPending } = useList<UtilityReading>("readings", { kind });
  const units = useAll<RentalUnit>("units");
  const unitFilter = useFilters((s) => s.unit);
  const dialog = useCrudDialog<UtilityReading, Form>(toForm);
  const save = useSave<Record<string, unknown> & { id?: number }>("readings", "Reading");
  const remove = useRemove("readings", "Reading");
  const { form, set, editing } = dialog;
  const meta = UTILITY_KINDS[kind];

  const totalUsage = rows?.reduce((s, r) => s + r.usage, 0) ?? 0;
  const totalCost = rows?.reduce((s, r) => s + (r.cost ?? 0), 0) ?? 0;
  const months = new Set(rows?.map((r) => r.period)).size;

  const submit = () =>
    save.mutate(
      {
        id: editing?.id,
        rental_unit: Number(form.rental_unit),
        kind: form.kind,
        period: `${form.month}-01`,
        meter_reading: numOrNull(form.meter_reading),
        usage: form.usage,
        cost: numOrNull(form.cost),
        notes: form.notes,
      },
      { onSuccess: () => dialog.setOpen(false) },
    );

  return (
    <Page
      title="Water & electricity"
      description="Monthly usage per unit, from the municipal bill or your own meter readings."
      actions={
        <Button
          onClick={() =>
            dialog.openNew({ kind, rental_unit: unitFilter || String(units.data?.[0]?.id ?? "") })
          }
        >
          <Plus /> Log reading
        </Button>
      }
    >
      <Tabs value={kind} onValueChange={(v) => setKind(v as UtilityKind)}>
        <TabsList>
          <TabsTrigger value="water">
            <Droplets /> Water
          </TabsTrigger>
          <TabsTrigger value="electricity">
            <Zap /> Electricity
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={`Total ${meta.label.toLowerCase()}`}
          value={`${formatNumber(totalUsage)} ${meta.unit}`}
        />
        <Stat
          label="Average per month"
          value={`${formatNumber(rows?.length ? totalUsage / rows.length : 0)} ${meta.unit}`}
          hint={`Per unit, per month · ${months} months`}
        />
        <Stat label="Total cost" value={formatMoney(totalCost)} tone="out" />
      </div>

      {rows && rows.length > 0 && <UsageBars rows={rows} kind={kind} />}

      {isPending && !rows ? (
        <TableSkeleton />
      ) : rows?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Meter</TableHead>
                <TableHead className="text-right">Usage</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => dialog.openEdit(row)}
                >
                  <TableCell>{formatMonth(row.period)}</TableCell>
                  <TableCell>{row.rental_unit_name}</TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                    {row.meter_reading != null ? formatNumber(row.meter_reading) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(row.usage)} {meta.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.cost != null ? formatMoney(row.cost) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title={`No ${meta.label.toLowerCase()} readings in this period`} />
      )}

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit reading" : "Log reading"}
        description="One reading per unit, per utility, per month. The bill payment itself is logged under Expense tracking."
        onSubmit={submit}
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        deleteLabel="this reading"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Utility" htmlFor="r-kind">
            <NativeSelect
              id="r-kind"
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as UtilityKind)}
            >
              {Object.entries(UTILITY_KINDS).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Month" htmlFor="r-month">
            <Input
              id="r-month"
              type="month"
              required
              value={form.month}
              onChange={(e) => set("month", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Rental unit" htmlFor="r-unit">
          <NativeSelect
            id="r-unit"
            required
            value={form.rental_unit}
            onChange={(e) => set("rental_unit", e.target.value)}
          >
            <option value="" disabled>
              Choose…
            </option>
            {units.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={`Usage (${UTILITY_KINDS[form.kind].unit})`} htmlFor="r-usage">
            <Input
              id="r-usage"
              type="number"
              step="0.01"
              min="0"
              required
              value={form.usage}
              onChange={(e) => set("usage", e.target.value)}
            />
          </Field>
          <Field label="Cost (R)" htmlFor="r-cost">
            <Input
              id="r-cost"
              type="number"
              step="0.01"
              min="0"
              value={form.cost}
              onChange={(e) => set("cost", e.target.value)}
            />
          </Field>
          <Field label="Meter reading" htmlFor="r-meter">
            <Input
              id="r-meter"
              type="number"
              step="0.01"
              value={form.meter_reading}
              onChange={(e) => set("meter_reading", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="r-notes">
          <Textarea
            id="r-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </CrudDialog>
    </Page>
  );
}

/** Usage per month (summed across the units in view), oldest first. */
function UsageBars({ rows, kind }: { rows: UtilityReading[]; kind: UtilityKind }) {
  const byMonth = new Map<string, number>();
  for (const row of rows) byMonth.set(row.period, (byMonth.get(row.period) ?? 0) + row.usage);
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(...months.map(([, v]) => v), 1);
  const color = kind === "water" ? "bg-sky-500" : "bg-amber-500";

  return (
    <section className="rounded-xl border p-4">
      <h3 className="mb-4 font-medium">Usage per month</h3>
      <div className="flex h-40 items-end gap-2 overflow-x-auto">
        {months.map(([month, value]) => (
          <div
            key={month}
            className="flex h-full min-w-9 flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {Math.round(value)}
            </span>
            <div
              className={cn("w-full max-w-8 rounded-t-sm", color)}
              style={{ height: `${(value / max) * 75}%` }}
              title={`${formatMonth(month)}: ${formatNumber(value)} ${UTILITY_KINDS[kind].unit}`}
            />
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">
              {formatMonth(month).replace(" 20", " '")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
