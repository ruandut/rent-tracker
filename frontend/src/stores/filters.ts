import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

import { toIso } from "@/lib/format";

export type Preset =
  | "this_month"
  | "last_month"
  | "last_3"
  | "this_year"
  | "last_12"
  | "all"
  | "custom";

export const PRESETS: Record<Preset, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3: "Last 3 months",
  this_year: "This year",
  last_12: "Last 12 months",
  all: "All time",
  custom: "Custom range",
};

type FilterState = {
  preset: Preset;
  /** Only used when preset is "custom"; other presets are worked out from today's date. */
  from: string;
  to: string;
  /** Rental unit id, or "" for all units. */
  unit: string;
  setPreset: (preset: Preset) => void;
  setRange: (from: string, to: string) => void;
  setUnit: (unit: string) => void;
};

/** The filters every screen shares (date range + rental unit), remembered between visits. */
export const useFilters = create<FilterState>()(
  persist(
    (set, get) => ({
      preset: "this_year",
      from: "",
      to: "",
      unit: "",
      setPreset: (preset) => {
        // Switching to custom starts from whatever range was showing.
        if (preset === "custom") set({ preset, ...rangeFor(get()) });
        else set({ preset });
      },
      setRange: (from, to) => set({ preset: "custom", from, to }),
      setUnit: (unit) => set({ unit }),
    }),
    { name: "rent-tracker.filters" },
  ),
);

export function rangeFor({ preset, from, to }: Pick<FilterState, "preset" | "from" | "to">) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthEnd = (year: number, month: number) => toIso(new Date(year, month + 1, 0));
  switch (preset) {
    case "this_month":
      return { from: toIso(new Date(y, m, 1)), to: monthEnd(y, m) };
    case "last_month":
      return { from: toIso(new Date(y, m - 1, 1)), to: monthEnd(y, m - 1) };
    case "last_3":
      return { from: toIso(new Date(y, m - 2, 1)), to: monthEnd(y, m) };
    case "this_year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_12":
      return { from: toIso(new Date(y, m - 11, 1)), to: monthEnd(y, m) };
    case "all":
      return { from: "", to: "" };
    case "custom":
      return { from, to };
  }
}

/** Query params for the API: { date_from, date_to, unit }, leaving out empty ones. */
export function useFilterParams(): Record<string, string> {
  const state = useFilters(
    useShallow((s) => ({ preset: s.preset, from: s.from, to: s.to, unit: s.unit })),
  );
  const { from, to } = rangeFor(state);
  const params: Record<string, string> = {};
  if (from) params.date_from = from;
  if (to) params.date_to = to;
  if (state.unit) params.unit = state.unit;
  return params;
}
