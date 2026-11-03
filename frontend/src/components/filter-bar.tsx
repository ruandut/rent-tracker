import { CalendarRange } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { NativeSelect } from "@/components/form";
import { Input } from "@/components/ui/input";
import { useAll } from "@/lib/api";
import type { RentalUnit } from "@/lib/types";
import { PRESETS, rangeFor, useFilters, type Preset } from "@/stores/filters";

/** Date range + rental unit, shared by every screen (kept in the Zustand filters store). */
export function FilterBar() {
  const filters = useFilters(useShallow((s) => s));
  const units = useAll<RentalUnit>("units");
  const { from, to } = rangeFor(filters);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarRange className="hidden size-4 text-muted-foreground sm:block" />
      <NativeSelect
        aria-label="Date range"
        className="w-auto"
        value={filters.preset}
        onChange={(e) => filters.setPreset(e.target.value as Preset)}
      >
        {Object.entries(PRESETS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </NativeSelect>
      {filters.preset !== "all" && (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            aria-label="From"
            className="w-36"
            value={from}
            max={to || undefined}
            onChange={(e) => filters.setRange(e.target.value, to)}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="To"
            className="w-36"
            value={to}
            min={from || undefined}
            onChange={(e) => filters.setRange(from, e.target.value)}
          />
        </div>
      )}
      <NativeSelect
        aria-label="Rental unit"
        className="w-auto"
        value={filters.unit}
        onChange={(e) => filters.setUnit(e.target.value)}
      >
        <option value="">All units</option>
        {units.data?.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
