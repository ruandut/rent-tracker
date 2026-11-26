import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Home } from "lucide-react";
import { useRef, useState } from "react";

import { Altcha, type AltchaHandle } from "@/components/altcha";
import { Field } from "@/components/form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useRealm } from "@/stores/realm";

type Invitation = {
  realm_name: string;
  email: string;
  invited_by: string | null;
  has_account: boolean;
};

export const Route = createFileRoute("/register")({
  validateSearch: (search: Record<string, unknown>): { invite?: string } =>
    typeof search.invite === "string" ? { invite: search.invite } : {},
  component: RegisterPage,
});

/** Public, unauthenticated JSON: these calls must not carry an old session's token. */
async function publicApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Joining by invitation link. There is no open sign-up: without an invite, this says so. */
function RegisterPage() {
  const { invite } = Route.useSearch();
  const invitation = useQuery({
    queryKey: ["invitation", invite],
    queryFn: () => publicApi<Invitation>(`/api/auth/invitations/${invite}/`),
    enabled: !!invite,
    retry: false,
  });

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-emerald-600 text-white">
            <Home className="size-5" />
          </div>
          {invitation.data ? (
            <>
              <CardTitle className="text-xl">Join {invitation.data.realm_name}</CardTitle>
              <CardDescription>
                {invitation.data.invited_by ?? "Someone"} invited {invitation.data.email} to share
                these books on Rent Tracker.
              </CardDescription>
            </>
          ) : (
            <CardTitle className="text-xl">Rent Tracker</CardTitle>
          )}
        </CardHeader>
        <CardContent>
          {!invite || invitation.isError ? (
            <p className="text-sm text-muted-foreground">
              This invitation link isn't valid. It may have been used or cancelled already. Ask
              whoever invited you for a new one, or{" "}
              <Link to="/login" className="underline underline-offset-4">
                sign in
              </Link>
              .
            </p>
          ) : !invitation.data ? (
            <div className="grid gap-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : invitation.data.has_account ? (
            <p className="text-sm text-muted-foreground">
              {invitation.data.email} already has an account.{" "}
              <Link to="/login" className="underline underline-offset-4">
                Sign in
              </Link>{" "}
              and accept the invitation under Realms.
            </p>
          ) : (
            <RegisterForm invite={invite} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RegisterForm({ invite }: { invite: string }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const mismatch = repeat !== "" && repeat !== password;
  const [captcha, setCaptcha] = useState<string | null>(null);
  const altcha = useRef<AltchaHandle>(null);
  const register = useMutation({
    mutationFn: (payload: string) =>
      publicApi<{ access: string; refresh: string }>("/api/auth/register/", {
        invite,
        username: username.trim(),
        password,
        altcha: payload,
      }),
    // Each captcha works once: solve a new one for the next attempt.
    onError: () => altcha.current?.renew(),
    onSuccess: (tokens) => {
      useAuth.getState().setTokens(tokens);
      // The new account is focused on the invitation's realm; let /me say which it is.
      useRealm.getState().setRealmId(null);
      void navigate({ to: "/" });
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch && captcha) register.mutate(captcha);
      }}
    >
      <Field label="Username" htmlFor="username">
        <Input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      <Field label="Repeat password" htmlFor="repeat">
        <Input
          id="repeat"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          aria-invalid={mismatch}
          required
        />
      </Field>
      {mismatch && <p className="text-sm text-destructive">The passwords don't match.</p>}
      <Altcha ref={altcha} onChange={setCaptcha} />
      {register.error && <p className="text-sm text-destructive">{register.error.message}</p>}
      <Button type="submit" disabled={register.isPending || mismatch || !captcha}>
        {register.isPending
          ? "Creating your account…"
          : captcha
            ? "Create account and join"
            : "Checking you're human…"}
      </Button>
    </form>
  );
}
