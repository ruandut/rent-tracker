import { create } from "zustand";
import { persist } from "zustand/middleware";

import { noteMaintenance } from "@/lib/maintenance";
import type { KeyOptions } from "@/lib/webauthn";

type Tokens = { access: string; refresh: string };

type AuthState = {
  access: string | null;
  refresh: string | null;
  setTokens: (tokens: Partial<Tokens>) => void;
  clear: () => void;
};

// JWTs in localStorage keeps a personal app simple; httpOnly cookies would be the hardened option.
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      access: null,
      refresh: null,
      setTokens: (tokens) =>
        set((s) => ({ access: tokens.access ?? s.access, refresh: tokens.refresh ?? s.refresh })),
      clear: () => set({ access: null, refresh: null }),
    }),
    { name: "rent-tracker.auth" },
  ),
);

export const isLoggedIn = () => useAuth.getState().refresh !== null;

/** Someone with two-factor sign-in owes a second step before they get tokens. */
export type SecondStep = {
  mfaToken: string;
  /** What they've set up: "totp" (an authenticator app), "webauthn" (keys), "recovery_codes". */
  methods: string[];
};

/**
 * `altcha` is the solved captcha payload (components/altcha.tsx). Resolves to null once signed
 * in, or to the second step for someone with 2FA (finish it with `finishLogin`).
 */
export async function login(
  username: string,
  password: string,
  altcha: string,
): Promise<SecondStep | null> {
  const res = await fetch("/api/auth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, altcha }),
  });
  await noteMaintenance(res);
  if (!res.ok) throw new Error(await loginError(res));
  const body = (await res.json()) as
    | Tokens
    | { mfa_required: true; mfa_token: string; methods: string[] };
  if ("mfa_required" in body) return { mfaToken: body.mfa_token, methods: body.methods };
  useAuth.getState().setTokens(body);
  return null;
}

/** Why a second step failed. "expired": start again with the password. "locked": wait. */
export class SecondStepError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function secondStep<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await noteMaintenance(res);
  const data = (await res.json().catch(() => null)) as
    | (T & { detail?: string; code?: string })
    | null;
  if (!res.ok)
    throw new SecondStepError(
      data?.detail ?? (res.status === 429 ? "Too many tries. Wait a minute." : "Sign in failed"),
      data?.code ?? "invalid",
    );
  return data as T;
}

/** Options for the browser to ask one of the person's security keys to sign in. */
export const loginKeyOptions = (mfaToken: string) =>
  secondStep<KeyOptions>("/api/auth/mfa/login/key-options/", { mfa_token: mfaToken });

/** Finishes signing in with a code (from the app, or a recovery code) or a key's answer. */
export async function finishLogin(
  mfaToken: string,
  proof: { code: string } | { credential: object },
): Promise<void> {
  const tokens = await secondStep<Tokens>("/api/auth/mfa/login/", {
    mfa_token: mfaToken,
    ...proof,
  });
  useAuth.getState().setTokens(tokens);
}

async function loginError(res: Response): Promise<string> {
  if (res.status === 401) return "Wrong username or password";
  const body = (await res.json().catch(() => null)) as {
    altcha?: string[];
    detail?: string;
  } | null;
  // 400 is the captcha's verdict; 429 a rate limit, whose detail says how long to wait.
  return body?.altcha?.[0] ?? body?.detail ?? "Login failed";
}

// Concurrent 401s share one refresh request instead of racing (refresh tokens rotate).
let refreshing: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    const { refresh, setTokens, clear } = useAuth.getState();
    if (!refresh) return null;
    const res = await fetch("/api/auth/token/refresh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    // Down for maintenance: keep the session for when the app is back.
    if (await noteMaintenance(res)) return null;
    if (!res.ok) {
      clear();
      return null;
    }
    const tokens = (await res.json()) as Partial<Tokens>;
    setTokens(tokens);
    return tokens.access ?? null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
