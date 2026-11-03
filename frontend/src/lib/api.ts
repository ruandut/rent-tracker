import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { refreshAccessToken, useAuth } from "@/stores/auth";
import { useFilterParams } from "@/stores/filters";

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
    if (typeof text !== "string") continue;
    return field === "detail" || field === "non_field_errors"
      ? text
      : `${field.replaceAll("_", " ")}: ${text}`;
  }
  return null;
}

/** fetch() for /api/* with the JWT attached and one transparent refresh on 401. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  };

  let res = await send(useAuth.getState().access);
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }
  if (res.status === 401) {
    useAuth.getState().clear();
    window.location.assign("/login");
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
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

export type Me = { id: number; username: string; email: string };
