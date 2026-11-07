import { create } from "zustand";
import { persist } from "zustand/middleware";

type RealmState = {
  /** The realm this tab works in, sent as X-Realm on every API call. null = the server's choice. */
  realmId: number | null;
  setRealmId: (realmId: number | null) => void;
};

/**
 * Kept per tab once loaded: switching realms in one tab doesn't change what another tab is
 * showing (or writing to). A new tab starts from the last realm chosen anywhere.
 */
export const useRealm = create<RealmState>()(
  persist(
    (set) => ({
      realmId: null,
      setRealmId: (realmId) => set({ realmId }),
    }),
    { name: "rent-tracker.realm" },
  ),
);
