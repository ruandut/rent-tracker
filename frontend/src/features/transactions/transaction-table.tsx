import { TagPill } from "@/components/tag-pill";
import { Money } from "@/components/money";
import { flexCell } from "@/components/page";
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

const accountLabel = (row: Transaction) =>
  row.kind === "transfer"
    ? `${row.payment_method_name} → ${row.transfer_to_name}`
    : row.payment_method_name;

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
  const rowTags = (row: Transaction) => row.tags.flatMap((id) => tagById.get(id) ?? []);

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
              <TableCell className={flexCell}>
                <div className="truncate font-medium" title={row.description || undefined}>
                  {row.description ||
                    (row.kind === "transfer" ? (
                      "Transfer"
                    ) : (
                      <span className="text-muted-foreground">No description</span>
                    ))}
                </div>
                {/* Always present and one line tall, so every row is the same height. */}
                <div className="mt-1 flex h-5 items-center gap-1 overflow-hidden">
                  {rowTags(row).map((tag) => (
                    <TagPill key={tag.id} name={tag.name} color={tag.color} className="shrink-0" />
                  ))}
                  {compact && row.beneficiary_name && (
                    <span className="truncate text-xs text-muted-foreground">
                      → {row.beneficiary_name}
                    </span>
                  )}
                  {row.tags.length === 0 && !(compact && row.beneficiary_name) && (
                    <span className="truncate text-xs text-muted-foreground">
                      {accountLabel(row)}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden max-w-32 truncate md:table-cell">
                {row.rental_unit_name ?? "—"}
              </TableCell>
              {!compact && (
                <TableCell className="hidden max-w-36 truncate lg:table-cell">
                  {row.beneficiary_name ?? "—"}
                </TableCell>
              )}
              <TableCell className="hidden max-w-40 truncate text-muted-foreground lg:table-cell">
                {accountLabel(row)}
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
