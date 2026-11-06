import { createFileRoute } from "@tanstack/react-router";
import { Minus, Plus, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { useCrudDialog } from "@/components/crud-dialog";
import { NativeSelect } from "@/components/form";
import { EmptyState, Page, Stat, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  toTransactionForm,
  TransactionDialog,
  type TransactionForm,
} from "@/features/transactions/transaction-dialog";
import { TransactionTable } from "@/features/transactions/transaction-table";
import { useAll, useList } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Beneficiary, PaymentMethod, Tag, Transaction } from "@/lib/types";
import { useFilters } from "@/stores/filters";

export const Route = createFileRoute("/_app/transactions/")({
  staticData: { title: "Expense tracking" },
  component: TransactionsPage,
});

function TransactionsPage() {
  const [kind, setKind] = useState("");
  const [tag, setTag] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());

  const extra = Object.fromEntries(
    Object.entries({ kind, tag, beneficiary, payment_method: method, q }).filter(([, v]) => v),
  );
  const { data: rows, isPending } = useList<Transaction>("transactions", extra);
  const tags = useAll<Tag>("tags");
  const people = useAll<Beneficiary>("beneficiaries");
  const methods = useAll<PaymentMethod>("payment-methods");
  const unit = useFilters((s) => s.unit);

  const dialog = useCrudDialog<Transaction, TransactionForm>(toTransactionForm);
  const openNew = (k: "income" | "expense") => {
    const active = methods.data?.filter((m) => m.is_active) ?? [];
    // Default to the bank account: that is where rent lands and most bills are paid from.
    const firstMethod = active.find((m) => m.kind === "bank_account") ?? active[0];
    dialog.openNew({
      kind: k,
      rental_unit: unit,
      payment_method: firstMethod ? String(firstMethod.id) : "",
    });
  };

  const income = rows?.filter((r) => r.kind === "income").reduce((s, r) => s + r.amount, 0) ?? 0;
  const expense = rows?.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0) ?? 0;

  return (
    <Page
      filters
      description="Every rand in and out of the rental account."
      actions={
        <>
          <Button variant="outline" onClick={() => openNew("income")}>
            <Plus /> Log income
          </Button>
          <Button onClick={() => openNew("expense")}>
            <Minus /> Log expense
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="In" value={formatMoney(income)} tone="in" />
        <Stat label="Out" value={formatMoney(expense)} tone="out" />
        <Stat
          label="Net"
          value={formatMoney(income - expense)}
          hint={`${rows?.length ?? 0} transactions`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search description, reference, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <NativeSelect
          aria-label="Direction"
          className="w-auto"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">In &amp; out</option>
          <option value="income">Money in</option>
          <option value="expense">Money out</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Tag"
          className="w-auto"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">All tags</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Beneficiary"
          className="w-auto"
          value={beneficiary}
          onChange={(e) => setBeneficiary(e.target.value)}
        >
          <option value="">All beneficiaries</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Payment method"
          className="w-auto"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="">All payment methods</option>
          {methods.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      {isPending && !rows ? (
        <TableSkeleton />
      ) : rows && rows.length > 0 ? (
        <TransactionTable rows={rows} onSelect={dialog.openEdit} />
      ) : (
        <EmptyState title="No transactions match">Try a wider date range, or log one.</EmptyState>
      )}

      <TransactionDialog dialog={dialog} />
    </Page>
  );
}
