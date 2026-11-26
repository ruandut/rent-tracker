import { create } from "zustand";
import { persist } from "zustand/middleware";

import { noteMaintenance } from "@/lib/maintenance";

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

/** `altcha` is the solved captcha payload (components/altcha.tsx). */
export async function login(username: string, password: string, altcha: string): Promise<void> {
  const res = await fetch("/api/auth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, altcha }),
  });
  await noteMaintenance(res);
  if (!res.ok) throw new Error(await loginError(res));
  useAuth.getState().setTokens((await res.json()) as Tokens);
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
