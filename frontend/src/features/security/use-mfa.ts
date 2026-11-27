import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { createCredential, keyError, type KeyOptions } from "@/lib/webauthn";

/**
 * Two-factor sign-in for the signed-in person, from django-foundation's foundation.mfa under
 * /api/auth/mfa/. It belongs to the account, not a realm, so nothing here is realm-scoped.
 */
const MFA = "/api/auth/mfa/";

type Factor = { id: number; created_at: string; last_used_at: string | null };
export type SecurityKey = Factor & { name: string };

export type MfaOverview = {
  /** Signing in asks for a second factor: an app or at least one key. */
  enabled: boolean;
  totp: Factor | null;
  keys: SecurityKey[];
  recovery_codes: { left: number; total: number } | null;
};

/** Recovery codes come back only from the change that made them: show them then, once. */
type Codes = { recovery_codes: string[] | null };

export function useMfa() {
  return useQuery({ queryKey: ["mfa"], queryFn: () => api<MfaOverview>(MFA) });
}

const post = <T>(path: string, body?: object, method = "POST") =>
  api<T>(MFA + path, { method, body: body && JSON.stringify(body) });

function useMfaMutation<V, T>(fn: (vars: V) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mfa"] }),
  });
}

/**
 * A new secret for an authenticator app, as a QR code (`svg`) and as text to type in. A query,
 * not a mutation, so React's double mount in development asks once; dropped as soon as the
 * dialog closes, so opening it again makes a fresh one. The server waits 10 minutes for it.
 */
export const useStartApp = () =>
  useQuery({
    queryKey: ["mfa-app-setup"],
    queryFn: () => post<{ secret: string; url: string; svg: string }>("totp/setup/"),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

export const useActivateApp = () =>
  useMfaMutation((vars: { code: string; password: string }) => post<Codes>("totp/", vars));

export const useRemoveApp = () =>
  useMfaMutation((password: string) => post<null>("totp/", { password }, "DELETE"));

/** Asks the browser for a new key or passkey, then saves it under `name`. */
export const useAddKey = () =>
  useMfaMutation(async (vars: { name: string; password: string }) => {
    const options = await post<KeyOptions>("keys/options/");
    let credential: object;
    try {
      credential = await createCredential(options);
    } catch (error) {
      throw new Error(keyError(error));
    }
    return post<Codes & { id: number }>("keys/", { ...vars, credential });
  });

export const useRenameKey = () =>
  useMfaMutation((vars: { id: number; name: string }) =>
    post<SecurityKey>(`keys/${vars.id}/`, { name: vars.name }, "PATCH"),
  );

export const useRemoveKey = () =>
  useMfaMutation((vars: { id: number; password: string }) =>
    post<null>(`keys/${vars.id}/`, { password: vars.password }, "DELETE"),
  );

export const useNewRecoveryCodes = () =>
  useMfaMutation((password: string) => post<Codes>("recovery-codes/", { password }));
