import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, type RealmRef } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { useFilters } from "@/stores/filters";
import { useRealm } from "@/stores/realm";

/**
 * Point this tab at another realm. Everything cached belongs to the old one, so it's reset
 * (screens still showing refetch from the new realm), and the unit filter is cleared because
 * unit ids don't carry over. /me is keyed by realm, so it needs no reset.
 */
export function enterRealm(realmId: number | null) {
  useFilters.getState().setUnit("");
  useRealm.getState().setRealmId(realmId);
  void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== "me" });
}

/** Switch realms, and make it the one new sessions open in. */
export function useSwitchRealm() {
  return useMutation({
    mutationFn: (realm: Pick<RealmRef, "id" | "name">) =>
      api(`/api/realms/${realm.id}/switch/`, { method: "POST" }),
    onSuccess: (_data, realm) => {
      enterRealm(realm.id);
      toast.success(`Switched to ${realm.name}`);
    },
    onError: (error) => toast.error(error.message),
  });
}
