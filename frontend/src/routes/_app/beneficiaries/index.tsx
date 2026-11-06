import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field } from "@/components/form";
import { Money } from "@/components/money";
import { EmptyState, flexCell, Page, TableSkeleton } from "@/components/page";
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
import type { Beneficiary } from "@/lib/types";

export const Route = createFileRoute("/_app/beneficiaries/")({
  staticData: { title: "Beneficiaries" },
  component: BeneficiariesPage,
});

type Form = { name: string; relationship: string; notes: string };

const toForm = (row?: Beneficiary): Form => ({
  name: row?.name ?? "",
  relationship: row?.relationship ?? "",
  notes: row?.notes ?? "",
});

function BeneficiariesPage() {
  const { data: rows, isPending } = useList<Beneficiary>("beneficiaries");
  const dialog = useCrudDialog<Beneficiary, Form>(toForm);
  const save = useSave<Form & { id?: number }>("beneficiaries", "Beneficiary");
  const remove = useRemove("beneficiaries", "Beneficiary");
  const { form, set, editing } = dialog;

  return (
    <Page
      filters
      description="People payments go to, like a share of the rent. Totals follow the filters."
      actions={
        <Button onClick={() => dialog.openNew()}>
          <Plus /> Add beneficiary
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
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Relationship</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Paid to them</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Received from them
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => dialog.openEdit(row)}
                >
                  <TableCell className={`${flexCell} font-medium`}>{row.name}</TableCell>
                  <TableCell className="hidden max-w-48 truncate text-muted-foreground sm:table-cell">
                    {row.relationship || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  <TableCell className="text-right">
                    <Money value={row.paid} kind="expense" />
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <Money value={row.received} kind="income" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No beneficiaries yet">Add someone you pay out to.</EmptyState>
      )}

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit beneficiary" : "Add beneficiary"}
        description={
          editing ? "Deleting keeps their transactions, just without a beneficiary." : undefined
        }
        onSubmit={() =>
          save.mutate({ id: editing?.id, ...form }, { onSuccess: () => dialog.setOpen(false) })
        }
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        deleteLabel={editing?.name}
      >
        <Field label="Name" htmlFor="b-name">
          <Input
            id="b-name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Relationship" htmlFor="b-rel">
          <Input
            id="b-rel"
            placeholder="Spouse, contractor, agent…"
            value={form.relationship}
            onChange={(e) => set("relationship", e.target.value)}
          />
        </Field>
        <Field label="Notes" htmlFor="b-notes">
          <Textarea
            id="b-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </CrudDialog>
    </Page>
  );
}
