import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, TableSkeleton } from "@/components/page";
import { TemplateBuilder } from "@/components/template-builder";
import { api } from "@/lib/api";
import type { BillTemplate } from "@/lib/types";

export const Route = createFileRoute("/_app/templates/$templateId")({
  staticData: { title: "Edit template" },
  component: TemplatePage,
});

function TemplatePage() {
  const { templateId } = Route.useParams();
  const template = useQuery({
    queryKey: ["bill-templates", "detail", templateId],
    queryFn: () => api<BillTemplate>(`/api/bill-templates/${templateId}/`),
    refetchOnWindowFocus: false,
  });
  if (template.data) {
    return (
      <TemplateBuilder key={template.data.id} template={template.data} initial={template.data} />
    );
  }
  return (
    <div className="p-4 md:p-6">
      {template.isPending ? <TableSkeleton /> : <EmptyState title="This template doesn't exist" />}
    </div>
  );
}
