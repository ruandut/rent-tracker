import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Home, KeyRound } from "lucide-react";
import { useRef, useState } from "react";

import { Altcha, type AltchaHandle } from "@/components/altcha";
import { Field } from "@/components/form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { keyError, getCredential, webauthnAvailable } from "@/lib/webauthn";
import {
  finishLogin,
  isLoggedIn,
  login,
  loginKeyOptions,
  type SecondStep,
  SecondStepError,
} from "@/stores/auth";
import { useRealm } from "@/stores/realm";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (isLoggedIn()) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const altcha = useRef<AltchaHandle>(null);
  const [step, setStep] = useState<SecondStep | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signedIn = () => {
    // Start from the realm this account last used, not whatever this browser last showed.
    useRealm.getState().setRealmId(null);
    void navigate({ to: "/" });
  };
  const signIn = useMutation({
    mutationFn: (payload: string) => login(username, password, payload),
    // Each captcha works once: solve a new one for the next attempt (or for starting over).
    onSettled: () => altcha.current?.renew(),
    onSuccess: (next) => {
      setNotice(null);
      if (next) setStep(next);
      else signedIn();
    },
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
          <CardTitle className="text-xl">Rent Tracker</CardTitle>
          <CardDescription>
            {step
              ? "Two-factor sign-in is on for this account. Confirm it's you."
              : "Sign in to see what's moving through the rental account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step && (
            <SecondStepForm
              step={step}
              onDone={signedIn}
              onStartOver={(message) => {
                setStep(null);
                setPassword("");
                setNotice(message);
              }}
            />
          )}
          <form
            hidden={!!step}
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (captcha) signIn.mutate(captcha);
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Altcha ref={altcha} onChange={setCaptcha} />
            {notice && !signIn.error && <p className="text-sm text-destructive">{notice}</p>}
            {signIn.error && <p className="text-sm text-destructive">{signIn.error.message}</p>}
            <Button type="submit" disabled={signIn.isPending || !captcha}>
              {signIn.isPending ? "Signing in…" : captcha ? "Sign in" : "Checking you're human…"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** The code from an authenticator app, a recovery code, or a security key. */
function SecondStepForm({
  step,
  onDone,
  onStartOver,
}: {
  step: SecondStep;
  onDone: () => void;
  onStartOver: (message: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const hasApp = step.methods.includes("totp");
  const canUseKey = step.methods.includes("webauthn") && webauthnAvailable();
  const finish = useMutation({
    mutationFn: async (proof: "code" | "key") => {
      if (proof === "code") return finishLogin(step.mfaToken, { code });
      let credential: object;
      try {
        credential = await getCredential(await loginKeyOptions(step.mfaToken));
      } catch (error) {
        if (error instanceof SecondStepError) throw error;
        throw new Error(keyError(error));
      }
      return finishLogin(step.mfaToken, { credential });
    },
    onSuccess: onDone,
    onError: (error) => {
      // The password step has to be done again; a lockout is told there too.
      if (error instanceof SecondStepError && error.code === "expired") onStartOver(error.message);
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) finish.mutate("code");
      }}
    >
      {canUseKey && (
        <>
          <Button type="button" disabled={finish.isPending} onClick={() => finish.mutate("key")}>
            <KeyRound /> Use a security key or passkey
          </Button>
          <p className="text-center text-xs text-muted-foreground">or enter a code</p>
        </>
      )}
      <Field
        label={hasApp ? "Authentication code" : "Recovery code"}
        htmlFor="code"
        hint={
          hasApp
            ? "The 6-digit code from your authenticator app, or one of your recovery codes."
            : step.methods.includes("webauthn") && !canUseKey
              ? "Security keys only work on this site's https address. Use a recovery code here."
              : "One of the recovery codes you saved."
        }
      >
        <Input
          id="code"
          autoComplete="one-time-code"
          inputMode={hasApp ? "numeric" : "text"}
          autoFocus={!canUseKey}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      {finish.error && <p className="text-sm text-destructive">{finish.error.message}</p>}
      <Button
        type="submit"
        variant={canUseKey ? "outline" : "default"}
        disabled={finish.isPending || !code.trim()}
      >
        {finish.isPending ? "Checking…" : "Verify"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => onStartOver(null)}>
        Back to sign in
      </Button>
    </form>
  );
}
