import { CalendarRange } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { useShallow } from "zustand/react/shallow";

import { Field, NativeSelect } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAll } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { RentalUnit } from "@/lib/types";
import { PRESETS, rangeFor, useFilters, type Preset } from "@/stores/filters";

/**
 * Date range + rental unit, shared by every screen (kept in the Zustand filters store).
 * Inline on larger screens; on a phone it's one button that opens the controls in a modal.
 */
export function FilterBar() {
  return useIsMobile() ? <MobileFilter /> : <InlineFilter />;
}

function useFilterState() {
  const filters = useFilters(useShallow((s) => s));
  return { filters, ...rangeFor(filters) };
}

function PresetSelect(props: Pick<ComponentProps<"select">, "id" | "className">) {
  const { filters } = useFilterState();
  return (
    <NativeSelect
      aria-label="Date range"
      value={filters.preset}
      onChange={(e) => filters.setPreset(e.target.value as Preset)}
      {...props}
    >
      {Object.entries(PRESETS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </NativeSelect>
  );
}

function UnitSelect(props: Pick<ComponentProps<"select">, "id" | "className">) {
  const { filters } = useFilterState();
  const units = useAll<RentalUnit>("units");
  return (
    <NativeSelect
      aria-label="Rental unit"
      value={filters.unit}
      onChange={(e) => filters.setUnit(e.target.value)}
      {...props}
    >
      <option value="">All units</option>
      {units.data?.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {unit.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function FromInput(props: Pick<ComponentProps<"input">, "id" | "className">) {
  const { filters, from, to } = useFilterState();
  return (
    <Input
      type="date"
      aria-label="From"
      value={from}
      max={to || undefined}
      onChange={(e) => filters.setRange(e.target.value, to)}
      {...props}
    />
  );
}

function ToInput(props: Pick<ComponentProps<"input">, "id" | "className">) {
  const { filters, from, to } = useFilterState();
  return (
    <Input
      type="date"
      aria-label="To"
      value={to}
      min={from || undefined}
      onChange={(e) => filters.setRange(from, e.target.value)}
      {...props}
    />
  );
}

function InlineFilter() {
  const { filters } = useFilterState();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border p-2">
      <CalendarRange className="size-4 text-muted-foreground" />
      <PresetSelect className="w-auto" />
      {filters.preset !== "all" && (
        <div className="flex items-center gap-1">
          <FromInput className="w-36" />
          <span className="text-muted-foreground">–</span>
          <ToInput className="w-36" />
        </div>
      )}
      <UnitSelect className="w-auto" />
    </div>
  );
}

function MobileFilter() {
  const [open, setOpen] = useState(false);
  const { filters, from, to } = useFilterState();
  const units = useAll<RentalUnit>("units");

  const period =
    filters.preset === "custom" && from && to
      ? `${formatDate(from)} – ${formatDate(to)}`
      : PRESETS[filters.preset];
  const unit = units.data?.find((u) => String(u.id) === filters.unit)?.name ?? "All units";

  return (
    <>
      <Button
        variant="outline"
        className="w-full justify-start"
        aria-label={`Filters: ${period}, ${unit}`}
        onClick={() => setOpen(true)}
      >
        <CalendarRange />
        <span className="min-w-0 truncate">
          {period} · {unit}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>These apply to every screen with filters.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Date range" htmlFor="filter-preset">
              <PresetSelect id="filter-preset" />
            </Field>
            {filters.preset !== "all" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="filter-from">
                  <FromInput id="filter-from" className="min-w-0" />
                </Field>
                <Field label="To" htmlFor="filter-to">
                  <ToInput id="filter-to" className="min-w-0" />
                </Field>
              </div>
            )}
            <Field label="Rental unit" htmlFor="filter-unit">
              <UnitSelect id="filter-unit" />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
