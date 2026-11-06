import { createFileRoute } from "@tanstack/react-router";
import { Lock, Plus } from "lucide-react";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field } from "@/components/form";
import { Money } from "@/components/money";
import { EmptyState, flexCell, Page, TableSkeleton } from "@/components/page";
import { swatchClass, TAG_COLORS, TagPill } from "@/components/tag-pill";
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
import { useList, useRemove, useSave } from "@/lib/api";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/tags/")({
  staticData: { title: "Tags" },
  component: TagsPage,
});

type Form = { name: string; color: string };

const toForm = (row?: Tag): Form => ({ name: row?.name ?? "", color: row?.color ?? "slate" });

function TagsPage() {
  const { data: rows, isPending } = useList<Tag>("tags");
  const dialog = useCrudDialog<Tag, Form>(toForm);
  const save = useSave<Form & { id?: number }>("tags", "Tag");
  const remove = useRemove("tags", "Tag");
  const { form, set, editing } = dialog;

  return (
    <Page
      filters
      description="Label transactions to see where the money goes. Totals follow the filters."
      actions={
        <Button onClick={() => dialog.openNew()}>
          <Plus /> Add tag
        </Button>
      }
    >
      {isPending && !rows ? (
        <TableSkeleton rows={4} />
      ) : rows?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => dialog.openEdit(row)}
                >
                  <TableCell className={flexCell}>
                    <span className="flex items-center gap-2">
                      <TagPill name={row.name} color={row.color} />
                      {row.is_system && (
                        <span title="System tag: can be renamed, not deleted">
                          <Lock className="size-3.5 text-muted-foreground" />
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  <TableCell className="text-right">
                    <Money value={row.total} kind="expense" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No tags yet" />
      )}

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit tag" : "Add tag"}
        description={
          editing?.is_system
            ? "This is a system tag: you can rename or recolour it, not delete it."
            : undefined
        }
        onSubmit={() =>
          save.mutate({ id: editing?.id, ...form }, { onSuccess: () => dialog.setOpen(false) })
        }
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing && !editing.is_system ? () => remove.mutate(editing.id) : undefined}
        deleteLabel={editing ? `the "${editing.name}" tag` : undefined}
      >
        <Field label="Name" htmlFor="t-name">
          <Input
            id="t-name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {Object.keys(TAG_COLORS).map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={form.color === color}
                onClick={() => set("color", color)}
                className={cn(
                  "size-7 rounded-full ring-offset-2 ring-offset-background transition",
                  swatchClass(color),
                  form.color === color && "ring-2 ring-ring",
                )}
              />
            ))}
          </div>
        </Field>
        <div className="text-sm text-muted-foreground">
          Preview: <TagPill name={form.name || "tag"} color={form.color} />
        </div>
      </CrudDialog>
    </Page>
  );
}
