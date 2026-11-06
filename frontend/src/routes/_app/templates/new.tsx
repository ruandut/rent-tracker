import { createFileRoute } from "@tanstack/react-router";

import { TableSkeleton } from "@/components/page";
import { TemplateBuilder } from "@/components/template-builder";
import { useAll } from "@/lib/api";
import type { BillTemplate } from "@/lib/types";

export const Route = createFileRoute("/_app/templates/new")({
  staticData: { title: "New template" },
  validateSearch: (search): { from?: number } => ({
    from: Number.isInteger(search.from) ? (search.from as number) : undefined,
  }),
  component: NewTemplatePage,
});

/** Starts from a copy of the chosen template, or of the default. */
function NewTemplatePage() {
  const { from } = Route.useSearch();
  const templates = useAll<BillTemplate>("bill-templates");
  if (!templates.data) {
    return (
      <div className="p-4 md:p-6">
        <TableSkeleton />
      </div>
    );
  }
  const source =
    templates.data.find((template) => template.id === from) ??
    templates.data.find((template) => template.is_default);
  return (
    <TemplateBuilder
      key={source?.id}
      initial={{
        name: from !== undefined && source ? `${source.name} copy` : "",
        is_default: false,
        definition: source?.definition ?? { bill_fields: [], sections: [] },
      }}
    />
  );
}
