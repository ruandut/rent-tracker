import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field, NativeSelect } from "@/components/form";
import { EmptyState, Page, Stat, TableSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { useAll, useList, useRemove, useSave } from "@/lib/api";
import { formatMoney, formatMonth, thisMonth } from "@/lib/format";
import {
  CHARGE_CATEGORIES,
  type ChargeCategory,
  type MunicipalCharge,
  type RentalUnit,
} from "@/lib/types";
import { useFilters } from "@/stores/filters";

export const Route = createFileRoute("/_app/charges/")({
  component: ChargesPage,
});

type Form = {
  rental_unit: string;
  category: ChargeCategory;
  month: string;
  amount: string;
  description: string;
  notes: string;
};

const toForm = (row?: MunicipalCharge): Form => ({
  rental_unit: row ? String(row.rental_unit) : "",
  category: row?.category ?? "rates_taxes",
  month: row ? row.period.slice(0, 7) : thisMonth(),
  amount: row ? String(row.amount) : "",
  description: row?.description ?? "",
  notes: row?.notes ?? "",
});

function ChargesPage() {
  const [category, setCategory] = useState("");
  const { data: rows, isPending } = useList<MunicipalCharge>(
    "charges",
    category ? { category } : {},
  );
  const units = useAll<RentalUnit>("units");
  const unitFilter = useFilters((s) => s.unit);
  const dialog = useCrudDialog<MunicipalCharge, Form>(toForm);
  const save = useSave<Record<string, unknown> & { id?: number }>("charges", "Charge");
  const remove = useRemove("charges", "Charge");
  const { form, set, editing } = dialog;

  const total = rows?.reduce((s, r) => s + r.amount, 0) ?? 0;
  const byCategory = new Map<ChargeCategory, number>();
  for (const row of rows ?? [])
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);
  const top = [...byCategory.entries()].sort(([, a], [, b]) => b - a).slice(0, 2);

  const submit = () =>
    save.mutate(
      {
        id: editing?.id,
        rental_unit: Number(form.rental_unit),
        category: form.category,
        period: `${form.month}-01`,
        amount: form.amount,
        description: form.description,
        notes: form.notes,
      },
      { onSuccess: () => dialog.setOpen(false) },
    );

  return (
    <Page
      title="Rates & taxes"
      description="What the municipality (or body corporate) bills each unit per month."
      actions={
        <Button
          onClick={() =>
            dialog.openNew({ rental_unit: unitFilter || String(units.data?.[0]?.id ?? "") })
          }
        >
          <Plus /> Log charge
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Total billed"
          value={formatMoney(total)}
          tone="out"
          hint={`${rows?.length ?? 0} charges`}
        />
        {top.map(([cat, value]) => (
          <Stat key={cat} label={CHARGE_CATEGORIES[cat]} value={formatMoney(value)} />
        ))}
      </div>

      <NativeSelect
        aria-label="Category"
        className="w-auto justify-self-start"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">All categories</option>
        {Object.entries(CHARGE_CATEGORIES).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </NativeSelect>

      {isPending && !rows ? (
        <TableSkeleton />
      ) : rows?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
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
                  <TableCell>
                    {CHARGE_CATEGORIES[row.category]}{" "}
                    {row.transaction && (
                      <Badge variant="secondary" title="Linked to a payment in Expense tracking">
                        Paid
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {row.description || "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(row.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No charges in this period" />
      )}

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit charge" : "Log charge"}
        description="Record what was billed. Log the payment itself under Expense tracking."
        onSubmit={submit}
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        deleteLabel="this charge"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="c-category">
            <NativeSelect
              id="c-category"
              value={form.category}
              onChange={(e) => set("category", e.target.value as ChargeCategory)}
            >
              {Object.entries(CHARGE_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Month" htmlFor="c-month">
            <Input
              id="c-month"
              type="month"
              required
              value={form.month}
              onChange={(e) => set("month", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rental unit" htmlFor="c-unit">
            <NativeSelect
              id="c-unit"
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
          <Field label="Amount (R)" htmlFor="c-amount">
            <Input
              id="c-amount"
              type="number"
              step="0.01"
              min="0"
              required
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="c-description">
          <Input
            id="c-description"
            placeholder="Account number, bill reference…"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field label="Notes" htmlFor="c-notes">
          <Textarea
            id="c-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </CrudDialog>
    </Page>
  );
}
