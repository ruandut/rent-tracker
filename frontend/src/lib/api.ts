import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { noteMaintenance } from "@/lib/maintenance";
import { queryClient } from "@/lib/query-client";
import type { RealmRole } from "@/lib/types";
import { refreshAccessToken, useAuth } from "@/stores/auth";
import { useFilterParams } from "@/stores/filters";
import { useRealm } from "@/stores/realm";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(describe(body) ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

/** First human-readable message out of a DRF error body. */
function describe(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const entries = Object.entries(body as Record<string, unknown>);
  for (const [field, value] of entries) {
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text !== "string") {
      // Nested serializers report per-row errors, e.g. {lines: [{}, {usage: ["…"]}]}.
      const nested = describe(value);
      if (nested) return nested;
      continue;
    }
    // The captcha's and two-factor sign-in's messages (django-foundation) read fine on their own.
    return ["detail", "non_field_errors", "altcha", "password", "code", "credential"].includes(
      field,
    )
      ? text
      : `${field.replaceAll("_", " ")}: ${text}`;
  }
  return null;
}

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers);
    // The browser sets a FormData body's Content-Type itself, including the boundary.
    if (!headers.has("Content-Type") && !(init.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const { realmId } = useRealm.getState();
    if (realmId !== null && !headers.has("X-Realm")) headers.set("X-Realm", String(realmId));
    return fetch(path, { ...init, headers });
  };

  let res = await send(useAuth.getState().access);
  // Down for maintenance says nothing about the session: keep it for when the app is back.
  if (await noteMaintenance(res)) return res;
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
    if (await noteMaintenance(res)) return res;
  }
  if (res.status === 401) {
    useAuth.getState().clear();
    window.location.assign("/login");
  }
  if (res.status === 403) {
    // Removed from this realm, or it was deleted: /me works out where to go instead.
    const code = (
      (await res
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null
    )?.code;
    if (code === "not_member" || code === "no_realm")
      void queryClient.invalidateQueries({ queryKey: ["me"] });
  }
  return res;
}

/** fetch() for /api/* with the JWT attached and one transparent refresh on 401. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, init);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** A file from the API. Plain links can't carry the JWT, so files come through fetch. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await authedFetch(path, {});
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.blob();
}

const withParams = (path: string, params: Record<string, string>) => {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${path}?${qs}` : path;
};

/**
 * A list endpoint, filtered by the shared date range + unit (and any `extra` params).
 * keepPreviousData: changing a filter keeps the current rows on screen until the new ones land.
 */
export function useList<T>(resource: string, extra: Record<string, string> = {}) {
  const params = { ...useFilterParams(), ...extra };
  return useQuery({
    queryKey: [resource, params],
    queryFn: () => api<T[]>(withParams(`/api/${resource}/`, params)),
    placeholderData: keepPreviousData,
  });
}

/** Same as useList but without the shared filters: for pickers that need every option. */
export function useAll<T>(resource: string) {
  return useQuery({ queryKey: [resource, "all"], queryFn: () => api<T[]>(`/api/${resource}/`) });
}

export function useFiltered<T>(path: string, key: string) {
  const params = useFilterParams();
  return useQuery({
    queryKey: [key, params],
    queryFn: () => api<T>(withParams(path, params)),
    placeholderData: keepPreviousData,
  });
}

/**
 * Create (no id) or update (with id). Every screen shows totals derived from transactions,
 * so a successful write simply invalidates everything rather than tracking dependencies.
 */
export function useSave<T extends { id?: number }>(resource: string, label: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: T) =>
      api(id ? `/api/${resource}/${id}/` : `/api/${resource}/`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      toast.success(`${label} ${vars.id ? "updated" : "added"}`);
      void queryClient.invalidateQueries();
    },
  });
}

export function useRemove(resource: string, label: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/api/${resource}/${id}/`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`${label} deleted`);
      void queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
}

export type RealmRef = { id: number; name: string; role: RealmRole };

export type Me = {
  id: number;
  username: string;
  email: string;
  /** The realm this tab's requests work in; null when the user has none (or lost access). */
  realm: RealmRef | null;
  realms: RealmRef[];
  pending_invitations: number;
};

/** Keyed by the tab's realm, as the answer depends on the X-Realm header sent with it. */
export function useMe() {
  const realmId = useRealm((s) => s.realmId);
  return useQuery({ queryKey: ["me", realmId], queryFn: () => api<Me>("/api/auth/me/") });
}
