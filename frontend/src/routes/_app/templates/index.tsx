import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { EmptyState, flexCell, Page, TableSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAll } from "@/lib/api";
import type { BillTemplate } from "@/lib/types";

export const Route = createFileRoute("/_app/templates/")({
  staticData: { title: "Municipal template builder" },
  component: TemplatesPage,
});

function TemplatesPage() {
  const { data: rows, isPending } = useAll<BillTemplate>("bill-templates");
  const navigate = useNavigate();

  return (
    <Page
      description="Each municipality's bill layout: its fields, its services and where their costs go."
      actions={
        <Button asChild>
          <Link to="/templates/new">
            <Plus /> New template
          </Link>
        </Button>
      }
    >
      {isPending && !rows ? (
        <TableSkeleton />
      ) : rows?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead className="text-right">Services</TableHead>
                <TableHead className="text-right">Bills</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() =>
                    void navigate({
                      to: "/templates/$templateId",
                      params: { templateId: String(row.id) },
                    })
                  }
                >
                  <TableCell className={flexCell}>
                    {row.name}{" "}
                    {row.is_default && (
                      <Badge variant="secondary" className="align-top">
                        Default
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.definition.sections.length}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.bill_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No templates yet" />
      )}
    </Page>
  );
}
