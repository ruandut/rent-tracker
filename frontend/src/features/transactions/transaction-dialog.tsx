import { Check } from "lucide-react";

import { CrudDialog, type useCrudDialog } from "@/components/crud-dialog";
import { Field, idOrNull, NativeSelect } from "@/components/form";
import { colorClass } from "@/components/tag-pill";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAll, useRemove, useSave } from "@/lib/api";
import { today } from "@/lib/format";
import type {
  Beneficiary,
  PaymentMethod,
  RentalUnit,
  Tag,
  Transaction,
  TransactionKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export type TransactionForm = {
  kind: TransactionKind;
  amount: string;
  date: string;
  description: string;
  payment_method: string;
  rental_unit: string;
  beneficiary: string;
  tags: number[];
  reference: string;
  notes: string;
};

export const toTransactionForm = (row?: Transaction): TransactionForm => ({
  kind: row?.kind ?? "expense",
  amount: row ? String(row.amount) : "",
  date: row?.date ?? today(),
  description: row?.description ?? "",
  payment_method: row ? String(row.payment_method) : "",
  rental_unit: row?.rental_unit ? String(row.rental_unit) : "",
  beneficiary: row?.beneficiary ? String(row.beneficiary) : "",
  tags: row?.tags ?? [],
  reference: row?.reference ?? "",
  notes: row?.notes ?? "",
});

export function TransactionDialog({
  dialog,
}: {
  dialog: ReturnType<typeof useCrudDialog<Transaction, TransactionForm>>;
}) {
  const { form, set, editing } = dialog;
  const methods = useAll<PaymentMethod>("payment-methods");
  const units = useAll<RentalUnit>("units");
  const people = useAll<Beneficiary>("beneficiaries");
  const tags = useAll<Tag>("tags");
  const save = useSave<Record<string, unknown> & { id?: number }>("transactions", "Transaction");
  const remove = useRemove("transactions", "Transaction");

  const submit = () =>
    save.mutate(
      {
        id: editing?.id,
        ...form,
        payment_method: Number(form.payment_method),
        rental_unit: idOrNull(form.rental_unit),
        beneficiary: idOrNull(form.beneficiary),
      },
      { onSuccess: () => dialog.setOpen(false) },
    );

  const toggleTag = (id: number) =>
    set("tags", form.tags.includes(id) ? form.tags.filter((t) => t !== id) : [...form.tags, id]);

  const isIncome = form.kind === "income";
  return (
    <CrudDialog
      open={dialog.open}
      onOpenChange={(open) => {
        dialog.setOpen(open);
        if (!open) save.reset();
      }}
      title={editing ? "Edit transaction" : isIncome ? "Log income" : "Log expense"}
      onSubmit={submit}
      saving={save.isPending}
      error={save.error?.message}
      onDelete={editing ? () => remove.mutate(editing.id) : undefined}
      deleteLabel="this transaction"
    >
      <div
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        role="radiogroup"
        aria-label="Direction"
      >
        {(["income", "expense"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={form.kind === kind}
            onClick={() => set("kind", kind)}
            className={cn(
              "rounded-md py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              form.kind === kind && "bg-background text-foreground shadow-sm",
              form.kind === kind && kind === "income" && "text-emerald-600 dark:text-emerald-400",
              form.kind === kind && kind === "expense" && "text-rose-600 dark:text-rose-400",
            )}
          >
            {kind === "income" ? "Money in" : "Money out"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (R)" htmlFor="tx-amount">
          <Input
            id="tx-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
            autoFocus
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
        <Field label="Date" htmlFor="tx-date">
          <Input
            id="tx-date"
            type="date"
            required
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Description (optional)" htmlFor="tx-description">
        <Input
          id="tx-description"
          placeholder={isIncome ? "Rent March – Flat A" : "Plumber – geyser valve"}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payment method" htmlFor="tx-method">
          <NativeSelect
            id="tx-method"
            required
            value={form.payment_method}
            onChange={(e) => set("payment_method", e.target.value)}
          >
            <option value="" disabled>
              Choose…
            </option>
            {methods.data
              ?.filter((m) => m.is_active || String(m.id) === form.payment_method)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.last4 ? ` ••${m.last4}` : ""}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Rental unit" htmlFor="tx-unit">
          <NativeSelect
            id="tx-unit"
            value={form.rental_unit}
            onChange={(e) => set("rental_unit", e.target.value)}
          >
            <option value="">General / not unit-specific</option>
            {units.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field
        label="Beneficiary"
        htmlFor="tx-beneficiary"
        hint={
          isIncome ? "Who the money came from (optional)." : "Who received the money (optional)."
        }
      >
        <NativeSelect
          id="tx-beneficiary"
          value={form.beneficiary}
          onChange={(e) => set("beneficiary", e.target.value)}
        >
          <option value="">None</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {tags.data?.map((tag) => {
            const on = form.tags.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTag(tag.id)}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  on
                    ? cn(colorClass(tag.color), "border-transparent")
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {on && <Check className="size-3" />}
                {tag.name}
              </button>
            );
          })}
          {tags.data?.length === 0 && (
            <span className="text-sm text-muted-foreground">No tags yet.</span>
          )}
        </div>
      </Field>

      <Field label="Reference" htmlFor="tx-reference">
        <Input
          id="tx-reference"
          value={form.reference}
          onChange={(e) => set("reference", e.target.value)}
        />
      </Field>
      <Field label="Notes" htmlFor="tx-notes">
        <Textarea
          id="tx-notes"
          rows={2}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
    </CrudDialog>
  );
}
