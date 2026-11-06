import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field } from "@/components/form";
import { Money } from "@/components/money";
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
import { useList, useRemove, useSave } from "@/lib/api";
import type { RentalUnit } from "@/lib/types";

export const Route = createFileRoute("/_app/units/")({
  component: UnitsPage,
});

type Form = { name: string; address: string; notes: string; is_active: boolean };

const toForm = (row?: RentalUnit): Form => ({
  name: row?.name ?? "",
  address: row?.address ?? "",
  notes: row?.notes ?? "",
  is_active: row?.is_active ?? true,
});

function UnitsPage() {
  const { data: rows, isPending } = useList<RentalUnit>("units");
  const dialog = useCrudDialog<RentalUnit, Form>(toForm);
  const save = useSave<Form & { id?: number }>("units", "Rental unit");
  const remove = useRemove("units", "Rental unit");
  const { form, set, editing } = dialog;

  return (
    <Page
      title="Rental units"
      description="The properties you rent out. In/out totals follow the date filter."
      actions={
        <Button onClick={() => dialog.openNew()}>
          <Plus /> Add unit
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
                <TableHead>Unit</TableHead>
                <TableHead className="hidden sm:table-cell">Address</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => dialog.openEdit(row)}
                >
                  <TableCell className={`${flexCell} font-medium`}>
                    {row.name} {!row.is_active && <Badge variant="outline">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="hidden max-w-56 truncate text-muted-foreground sm:table-cell">
                    {row.address || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.income} kind="income" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.expense} kind="expense" />
                  </TableCell>
                  <TableCell className="hidden text-right font-medium sm:table-cell">
                    <Money value={row.income - row.expense} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No rental units yet">Add one so you can filter by unit.</EmptyState>
      )}

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit rental unit" : "Add rental unit"}
        description={
          editing
            ? "Deleting a unit also deletes its utility readings and charges; transactions are kept."
            : undefined
        }
        onSubmit={() =>
          save.mutate({ id: editing?.id, ...form }, { onSuccess: () => dialog.setOpen(false) })
        }
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        deleteLabel={editing?.name}
      >
        <Field label="Name" htmlFor="u-name">
          <Input
            id="u-name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Address" htmlFor="u-address">
          <Input
            id="u-address"
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={form.is_active}
            onChange={(e) => set("is_active", e.target.checked)}
          />
          Active
        </label>
        <Field label="Notes" htmlFor="u-notes">
          <Textarea
            id="u-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </CrudDialog>
    </Page>
  );
}
