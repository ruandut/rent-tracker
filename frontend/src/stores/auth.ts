import { create } from "zustand";
import { persist } from "zustand/middleware";

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

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Wrong username or password" : "Login failed");
  useAuth.getState().setTokens((await res.json()) as Tokens);
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
