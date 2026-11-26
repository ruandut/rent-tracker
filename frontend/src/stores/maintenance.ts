import { create } from "zustand";

type MaintenanceState = {
  /** The API answered 503 "maintenance": the database is being rolled back to a backup. */
  active: boolean;
  /** What the server said, shown on the maintenance page. */
  detail: string | null;
  start: (detail: string | null) => void;
  end: () => void;
};

/** Set by the network layer (lib/maintenance.ts); the root route shows the page. */
export const useMaintenance = create<MaintenanceState>()((set) => ({
  active: false,
  detail: null,
  start: (detail) => set({ active: true, detail }),
  end: () => set({ active: false, detail: null }),
}));
