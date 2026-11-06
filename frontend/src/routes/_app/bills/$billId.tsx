import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { BillEditor, toForm } from "@/components/bill-editor";
import { EmptyState, TableSkeleton } from "@/components/page";
import { api } from "@/lib/api";
import type { Bill } from "@/lib/types";

export const Route = createFileRoute("/_app/bills/$billId")({
  staticData: { title: "Edit bill" },
  component: BillPage,
});

function BillPage() {
  const { billId } = Route.useParams();
  const bill = useQuery({
    queryKey: ["bills", "detail", billId],
    queryFn: () => api<Bill>(`/api/bills/${billId}/`),
    // The form holds unsaved edits; a background refetch must not look like a new bill.
    refetchOnWindowFocus: false,
  });

  return (
    <div className="contents">
      {bill.data ? (
        <BillEditor
          key={bill.data.id}
          bill={bill.data}
          layout={bill.data.layout}
          initial={toForm(bill.data)}
        />
      ) : bill.isPending ? (
        <div className="p-4 md:p-6">
          <TableSkeleton />
        </div>
      ) : (
        <div className="p-4 md:p-6">
          <EmptyState title="This bill doesn't exist" />
        </div>
      )}
    </div>
  );
}
