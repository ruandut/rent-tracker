import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field, NativeSelect } from "@/components/form";
import { EmptyState, flexCell, Page, TableSkeleton } from "@/components/page";
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
import { useAll, useRemove, useSave } from "@/lib/api";
import { METER_KINDS, type Meter, type MeterKind, type RentalUnit } from "@/lib/types";

export const Route = createFileRoute("/_app/meters/")({
  staticData: { title: "Meters" },
  component: MetersPage,
});

type Form = {
  kind: MeterKind;
  number: string;
  rental_unit: string;
  prepaid: boolean;
  connection: string;
  tariff: string;
  notes: string;
};

const toForm = (row?: Meter): Form => ({
  kind: row?.kind ?? "water",
  number: row?.number ?? "",
  rental_unit: row ? String(row.rental_unit) : "",
  prepaid: row?.prepaid ?? false,
  connection: row?.connection ?? "",
  tariff: row?.tariff ?? "",
  notes: row?.notes ?? "",
});

function MetersPage() {
  const { data: rows, isPending } = useAll<Meter>("meters");
  const units = useAll<RentalUnit>("units");
  const dialog = useCrudDialog<Meter, Form>(toForm);
  const save = useSave<Omit<Form, "rental_unit"> & { id?: number; rental_unit: number }>(
    "meters",
    "Meter",
  );
  const remove = useRemove("meters", "Meter");
  const { form, set, editing } = dialog;

  return (
    <Page
      description="Each municipal meter and the unit it serves. A bill PDF uses these to split its readings and fees between units."
      actions={
        <Button onClick={() => dialog.openNew()}>
          <Plus /> Add meter
        </Button>
      }
    >
      {isPending && !rows ? (
        <TableSkeleton rows={3} />
      ) : rows?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meter</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden sm:table-cell">Kind</TableHead>
                <TableHead className="hidden sm:table-cell">Connection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => dialog.openEdit(row)}
                >
                  <TableCell className={`${flexCell} font-medium tabular-nums`}>
                    {row.number} {row.prepaid && <Badge variant="outline">Prepaid</Badge>}
                  </TableCell>
                  <TableCell className="max-w-32 truncate">{row.rental_unit_name}</TableCell>
                  <TableCell className="hidden sm:table-cell">{METER_KINDS[row.kind]}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {[row.connection, row.tariff].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No meters yet">
          Upload a bill PDF and link its meters from there, or add them here by the number on the
          bill.
        </EmptyState>
      )}

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit meter" : "Add meter"}
        description={editing ? "Bills already logged keep the unit they were split to." : undefined}
        onSubmit={() =>
          save.mutate(
            { id: editing?.id, ...form, rental_unit: Number(form.rental_unit) },
            { onSuccess: () => dialog.setOpen(false) },
          )
        }
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        deleteLabel={editing ? `meter ${editing.number}` : undefined}
      >
        <Field label="Meter number" htmlFor="m-number">
          <Input
            id="m-number"
            required
            value={form.number}
            onChange={(e) => set("number", e.target.value.trim())}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" htmlFor="m-kind">
            <NativeSelect
              id="m-kind"
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as MeterKind)}
            >
              {Object.entries(METER_KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Rental unit" htmlFor="m-unit">
            <NativeSelect
              id="m-unit"
              required
              value={form.rental_unit}
              onChange={(e) => set("rental_unit", e.target.value)}
            >
              <option value="" disabled>
                Choose…
              </option>
              {units.data
                ?.filter((unit) => unit.is_active || String(unit.id) === form.rental_unit)
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Connection size" htmlFor="m-connection">
            <Input
              id="m-connection"
              placeholder="20 Amps"
              value={form.connection}
              onChange={(e) => set("connection", e.target.value)}
            />
          </Field>
          <Field label="Tariff" htmlFor="m-tariff">
            <Input
              id="m-tariff"
              value={form.tariff}
              onChange={(e) => set("tariff", e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={form.prepaid}
            onChange={(e) => set("prepaid", e.target.checked)}
          />
          Prepaid
        </label>
        <Field label="Notes" htmlFor="m-notes">
          <Textarea
            id="m-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </CrudDialog>
    </Page>
  );
}
