import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { BillEditor, blankForm, carryForward } from "@/components/bill-editor";
import { Page, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api, useAll } from "@/lib/api";
import type { Bill, BillSummary, BillTemplate } from "@/lib/types";

export const Route = createFileRoute("/_app/bills/new")({
  staticData: { title: "Log bill" },
  validateSearch: (search): { template?: number } => ({
    template: Number.isInteger(search.template) ? (search.template as number) : undefined,
  }),
  component: NewBillPage,
});

const Loading = () => (
  <div className="p-4 md:p-6">
    <TableSkeleton />
  </div>
);

function NewBillPage() {
  const { template: chosen } = Route.useSearch();
  const templates = useAll<BillTemplate>("bill-templates");
  if (!templates.data) return <Loading />;

  const template =
    templates.data.find((other) => other.id === chosen) ??
    (templates.data.length === 1 ? templates.data[0] : undefined);
  if (template) return <NextBill key={template.id} template={template} />;

  return (
    <Page description="Which municipality's template is this bill on?">
      <div className="flex flex-wrap gap-2">
        {templates.data.map((option) => (
          <Button key={option.id} variant={option.is_default ? "default" : "outline"} asChild>
            <Link to="/bills/new" search={{ template: option.id }}>
              {option.name}
            </Link>
          </Button>
        ))}
      </div>
    </Page>
  );
}

/** Starts from the template's latest bill: same units, items and meters, amounts left blank. */
function NextBill({ template }: { template: BillTemplate }) {
  const bills = useAll<BillSummary>("bills");
  const latestId = bills.data?.find((bill) => bill.template === template.id)?.id;
  const latest = useQuery({
    queryKey: ["bills", "detail", String(latestId)],
    queryFn: () => api<Bill>(`/api/bills/${latestId}/`),
    enabled: latestId !== undefined,
  });
  if (bills.isPending || (latestId !== undefined && latest.isPending)) return <Loading />;

  const layout = { name: template.name, ...template.definition };
  return (
    <BillEditor
      layout={layout}
      templateId={template.id}
      initial={latest.data ? carryForward(latest.data, layout) : blankForm()}
    />
  );
}
