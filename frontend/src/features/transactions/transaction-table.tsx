import { TagPill } from "@/components/tag-pill";
import { Money } from "@/components/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAll } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Tag, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TransactionTable({
  rows,
  onSelect,
  compact,
}: {
  rows: Transaction[];
  onSelect?: (row: Transaction) => void;
  compact?: boolean;
}) {
  const tags = useAll<Tag>("tags");
  const tagById = new Map(tags.data?.map((t) => [t.id, t]));

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="hidden md:table-cell">Unit</TableHead>
            {!compact && <TableHead className="hidden lg:table-cell">Beneficiary</TableHead>}
            <TableHead className="hidden lg:table-cell">Paid via</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(onSelect && "cursor-pointer")}
              onClick={onSelect ? () => onSelect(row) : undefined}
            >
              <TableCell className="text-muted-foreground">{formatDate(row.date)}</TableCell>
              <TableCell className="max-w-72 whitespace-normal">
                <div className="font-medium">{row.description}</div>
                {(row.tags.length > 0 || (compact && row.beneficiary_name)) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.tags.map((id) => {
                      const tag = tagById.get(id);
                      return tag ? <TagPill key={id} name={tag.name} color={tag.color} /> : null;
                    })}
                    {compact && row.beneficiary_name && (
                      <span className="text-xs text-muted-foreground">
                        → {row.beneficiary_name}
                      </span>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">{row.rental_unit_name ?? "—"}</TableCell>
              {!compact && (
                <TableCell className="hidden lg:table-cell">
                  {row.beneficiary_name ?? "—"}
                </TableCell>
              )}
              <TableCell className="hidden text-muted-foreground lg:table-cell">
                {row.payment_method_name}
              </TableCell>
              <TableCell className="text-right font-medium">
                <Money value={row.amount} kind={row.kind} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
