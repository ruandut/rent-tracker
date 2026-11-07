import { createFileRoute } from "@tanstack/react-router";
import { Banknote, CreditCard, Landmark, PiggyBank, Plus, Wallet } from "lucide-react";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field, NativeSelect } from "@/components/form";
import { EmptyState, Page, TableSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useList, useRemove, useSave } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_KINDS, type PaymentMethod, type PaymentMethodKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/payment-methods/")({
  staticData: { title: "Payment methods" },
  component: PaymentMethodsPage,
});

const ICONS: Record<PaymentMethodKind, typeof Wallet> = {
  bank_account: Landmark,
  savings_account: PiggyBank,
  credit_card: CreditCard,
  debit_card: CreditCard,
  cash: Banknote,
  other: Wallet,
};

type Form = {
  name: string;
  kind: PaymentMethodKind;
  institution: string;
  last4: string;
  opening_balance: string;
  is_active: boolean;
  notes: string;
};

const toForm = (row?: PaymentMethod): Form => ({
  name: row?.name ?? "",
  kind: row?.kind ?? "bank_account",
  institution: row?.institution ?? "",
  last4: row?.last4 ?? "",
  opening_balance: row ? String(row.opening_balance) : "0",
  is_active: row?.is_active ?? true,
  notes: row?.notes ?? "",
});

function PaymentMethodsPage() {
  const { data: rows, isPending } = useList<PaymentMethod>("payment-methods");
  const dialog = useCrudDialog<PaymentMethod, Form>(toForm);
  const save = useSave<Form & { id?: number }>("payment-methods", "Payment method");
  const remove = useRemove("payment-methods", "Payment method");
  const { form, set, editing } = dialog;

  return (
    <Page
      filters
      description="The cards and accounts money moves through. Balance is all-time; in, out and moved follow the filters."
      actions={
        <Button onClick={() => dialog.openNew()}>
          <Plus /> Add payment method
        </Button>
      }
    >
      {isPending && !rows ? (
        <TableSkeleton rows={3} />
      ) : rows?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const Icon = ICONS[row.kind];
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => dialog.openEdit(row)}
                className={cn(
                  "grid gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50",
                  !row.is_active && "opacity-60",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {PAYMENT_METHOD_KINDS[row.kind]}
                      {row.institution && ` · ${row.institution}`}
                      {row.last4 && ` · ••${row.last4}`}
                    </div>
                  </div>
                  {!row.is_active && <Badge variant="outline">Inactive</Badge>}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Balance</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {formatMoney(row.balance)}
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    In {formatMoney(row.income)}
                  </span>
                  <span className="text-rose-600 dark:text-rose-400">
                    Out {formatMoney(row.expense)}
                  </span>
                </div>
                {(row.moved_in > 0 || row.moved_out > 0) && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Moved in {formatMoney(row.moved_in)}</span>
                    <span>Moved out {formatMoney(row.moved_out)}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No payment methods yet">
          Add the bank account your rent goes into.
        </EmptyState>
      )}

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit payment method" : "Add payment method"}
        onSubmit={() =>
          save.mutate({ id: editing?.id, ...form }, { onSuccess: () => dialog.setOpen(false) })
        }
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        deleteLabel={editing?.name}
      >
        <Field label="Name" htmlFor="pm-name">
          <Input
            id="pm-name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="pm-kind">
            <NativeSelect
              id="pm-kind"
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as PaymentMethodKind)}
            >
              {Object.entries(PAYMENT_METHOD_KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Bank / issuer" htmlFor="pm-institution">
            <Input
              id="pm-institution"
              value={form.institution}
              onChange={(e) => set("institution", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Last 4 digits" htmlFor="pm-last4">
            <Input
              id="pm-last4"
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              value={form.last4}
              onChange={(e) => set("last4", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field
            label="Opening balance (R)"
            htmlFor="pm-opening"
            hint="Balance when you started tracking."
          >
            <Input
              id="pm-opening"
              type="number"
              step="0.01"
              value={form.opening_balance}
              onChange={(e) => set("opening_balance", e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={form.is_active}
            onChange={(e) => set("is_active", e.target.checked)}
          />
          Active (shown when logging payments)
        </label>
        <Field label="Notes" htmlFor="pm-notes">
          <Textarea
            id="pm-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </CrudDialog>
    </Page>
  );
}
