import { createFileRoute } from "@tanstack/react-router";
import {
  Copy,
  Download,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Field } from "@/components/form";
import { Page, TableSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type MfaOverview,
  type SecurityKey,
  useActivateApp,
  useAddKey,
  useMfa,
  useNewRecoveryCodes,
  useRemoveApp,
  useRemoveKey,
  useRenameKey,
  useStartApp,
} from "@/features/security/use-mfa";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { webauthnAvailable } from "@/lib/webauthn";

export const Route = createFileRoute("/_app/security/")({
  staticData: { title: "Security" },
  component: SecurityPage,
});

/** Two-factor sign-in: an authenticator app, security keys or passkeys, and recovery codes. */
function SecurityPage() {
  const mfa = useMfa();
  // Recovery codes are only ever in the response that made them, so they're shown right away.
  const [codes, setCodes] = useState<string[] | null>(null);
  const showCodes = (made: string[] | null | undefined) => made && setCodes(made);

  return (
    <Page description="Ask for a second step when signing in, so a password alone isn't enough.">
      {!mfa.data ? (
        <TableSkeleton rows={3} />
      ) : (
        <div className="grid max-w-3xl gap-6">
          <Status mfa={mfa.data} />
          <AppCard mfa={mfa.data} onCodes={showCodes} />
          <KeysCard mfa={mfa.data} onCodes={showCodes} />
          {mfa.data.enabled && <RecoveryCard mfa={mfa.data} onCodes={showCodes} />}
        </div>
      )}
      <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />
    </Page>
  );
}

function Status({ mfa }: { mfa: MfaOverview }) {
  const Icon = mfa.enabled ? ShieldCheck : ShieldOff;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4",
        mfa.enabled
          ? "border-emerald-600/30 bg-emerald-600/5"
          : "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          mfa.enabled
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-amber-600 dark:text-amber-400",
        )}
      />
      <div className="grid gap-0.5">
        <p className="font-medium">Two-factor sign-in is {mfa.enabled ? "on" : "off"}</p>
        <p className="text-sm text-muted-foreground">
          {mfa.enabled
            ? "Signing in asks for a code from your app or one of your keys after your password."
            : "Add an authenticator app or a security key below to turn it on."}
        </p>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          {icon}
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  );
}

const used = (at: string | null) => (at ? `last used ${formatDateTime(at)}` : "never used");

/** "Turns 2FA off" only when this is the last app or key. */
const isLast = (mfa: MfaOverview) => (mfa.totp ? 1 : 0) + mfa.keys.length === 1;
const offWarning =
  "This is your last app or key: two-factor sign-in turns off with it, and your recovery codes are deleted.";

// --- authenticator app ----------------------------------------------------------------------

function AppCard({
  mfa,
  onCodes,
}: {
  mfa: MfaOverview;
  onCodes: (codes: string[] | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useRemoveApp();

  return (
    <Section
      icon={<Smartphone className="size-4" />}
      title="Authenticator app"
      description="A 6-digit code from an app such as Google Authenticator, 1Password or Authy."
      action={
        mfa.totp ? (
          <Button variant="outline" size="sm" onClick={() => setRemoving(true)}>
            <Trash2 /> Remove
          </Button>
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus /> Set up
          </Button>
        )
      }
    >
      {mfa.totp && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">On</Badge>
          Added {formatDateTime(mfa.totp.created_at)}, {used(mfa.totp.last_used_at)}
        </p>
      )}
      {adding && (
        <SetUpAppDialog
          onClose={(codes) => {
            setAdding(false);
            onCodes(codes);
          }}
        />
      )}
      <PasswordDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the authenticator app?"
        description={
          isLast(mfa) ? offWarning : "Its codes stop working. Your security keys still do."
        }
        confirm="Remove"
        destructive
        mutation={remove}
        onConfirm={(password) => remove.mutateAsync(password)}
        done={() => toast.success("Authenticator app removed")}
      />
    </Section>
  );
}

function SetUpAppDialog({ onClose }: { onClose: (codes: string[] | null) => void }) {
  const start = useStartApp();
  const activate = useActivateApp();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const setup = start.data;

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose(null)}
      title="Set up an authenticator app"
      description="Scan the QR code with your app, then enter the code it shows."
      submit="Turn on"
      pending={activate.isPending}
      error={(start.error ?? activate.error)?.message}
      onSubmit={() =>
        activate.mutate(
          { code: code.replaceAll(" ", ""), password },
          {
            onSuccess: (res) => {
              toast.success("Authenticator app added");
              onClose(res.recovery_codes);
            },
          },
        )
      }
    >
      <div className="grid justify-items-center gap-2">
        {setup ? (
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.svg)}`}
            alt="QR code for your authenticator app"
            className="size-44 rounded-lg bg-white p-2"
          />
        ) : (
          <div className="size-44 animate-pulse rounded-lg bg-muted" />
        )}
        {setup && (
          <div className="grid w-full gap-1 text-center">
            <p className="text-xs text-muted-foreground">Can't scan it? Enter this key instead:</p>
            <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all select-all">
              {setup.secret.match(/.{1,4}/g)?.join(" ")}
            </code>
          </div>
        )}
      </div>
      <Field label="Code from the app" htmlFor="totp-code">
        <Input
          id="totp-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </Field>
      <PasswordField value={password} onChange={setPassword} />
    </FormDialog>
  );
}

// --- security keys and passkeys -------------------------------------------------------------

function KeysCard({
  mfa,
  onCodes,
}: {
  mfa: MfaOverview;
  onCodes: (codes: string[] | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<SecurityKey | null>(null);
  const [removing, setRemoving] = useState<SecurityKey | null>(null);
  const available = webauthnAvailable();
  const remove = useRemoveKey();

  return (
    <Section
      icon={<KeyRound className="size-4" />}
      title="Security keys and passkeys"
      description="A USB or NFC key, or a passkey kept by your phone, laptop or password manager."
      action={
        <Button
          size="sm"
          variant={mfa.totp ? "outline" : "default"}
          disabled={!available}
          onClick={() => setAdding(true)}
        >
          <Plus /> Add a key
        </Button>
      }
    >
      {!available && (
        <p className="mb-3 text-sm text-muted-foreground">
          Keys only work when Rent Tracker is opened on its https address, not over http on the
          local network. Open it there to add or use one.
        </p>
      )}
      {mfa.keys.length ? (
        <ul className="divide-y rounded-lg border">
          {mfa.keys.map((key) => (
            <li key={key.id} className="flex items-center gap-2 px-3 py-2">
              <div className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium">{key.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  Added {formatDateTime(key.created_at)}, {used(key.last_used_at)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Rename ${key.name}`}
                onClick={() => setRenaming(key)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${key.name}`}
                onClick={() => setRemoving(key)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No keys yet.</p>
      )}
      {adding && (
        <AddKeyDialog
          onClose={(codes) => {
            setAdding(false);
            onCodes(codes);
          }}
        />
      )}
      {renaming && <RenameKeyDialog securityKey={renaming} onClose={() => setRenaming(null)} />}
      <PasswordDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this key"}?`}
        description={
          isLast(mfa)
            ? offWarning
            : "It can't be used to sign in any more. Remove it from the device too if you like."
        }
        confirm="Remove"
        destructive
        mutation={remove}
        onConfirm={(password) => remove.mutateAsync({ id: removing!.id, password })}
        done={() => toast.success("Key removed")}
      />
    </Section>
  );
}

function AddKeyDialog({ onClose }: { onClose: (codes: string[] | null) => void }) {
  const add = useAddKey();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose(null)}
      title="Add a security key or passkey"
      description="Name it so you can tell your keys apart. Your browser then asks for the key."
      submit={add.isPending ? "Waiting for the key…" : "Add key"}
      pending={add.isPending}
      error={add.error?.message}
      onSubmit={() =>
        add.mutate(
          { name: name.trim(), password },
          {
            onSuccess: (res) => {
              toast.success("Key added");
              onClose(res.recovery_codes);
            },
          },
        )
      }
    >
      <Field label="Name" htmlFor="key-name" hint="e.g. YubiKey, or My iPhone">
        <Input
          id="key-name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <PasswordField value={password} onChange={setPassword} />
    </FormDialog>
  );
}

function RenameKeyDialog({
  securityKey,
  onClose,
}: {
  securityKey: SecurityKey;
  onClose: () => void;
}) {
  const rename = useRenameKey();
  const [name, setName] = useState(securityKey.name);
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Rename key"
      submit="Save"
      pending={rename.isPending}
      error={rename.error?.message}
      onSubmit={() =>
        rename.mutate({ id: securityKey.id, name: name.trim() }, { onSuccess: onClose })
      }
    >
      <Field label="Name" htmlFor="rename-key">
        <Input
          id="rename-key"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
    </FormDialog>
  );
}

// --- recovery codes -------------------------------------------------------------------------

function RecoveryCard({
  mfa,
  onCodes,
}: {
  mfa: MfaOverview;
  onCodes: (codes: string[] | null) => void;
}) {
  const [renewing, setRenewing] = useState(false);
  const renew = useNewRecoveryCodes();
  const left = mfa.recovery_codes?.left ?? 0;
  return (
    <Section
      icon={<RefreshCw className="size-4" />}
      title="Recovery codes"
      description="Each works once, to sign in without your app or keys. Keep them somewhere safe."
      action={
        <Button variant="outline" size="sm" onClick={() => setRenewing(true)}>
          <RefreshCw /> New codes
        </Button>
      }
    >
      <p className={cn("text-sm", left <= 2 ? "text-destructive" : "text-muted-foreground")}>
        {left} of {mfa.recovery_codes?.total ?? 10} left.
        {left <= 2 && " Make new ones before you run out."}
      </p>
      <PasswordDialog
        open={renewing}
        onOpenChange={setRenewing}
        title="Make new recovery codes?"
        description="Your old codes stop working, used or not."
        confirm="Make new codes"
        mutation={renew}
        onConfirm={async (password) => onCodes((await renew.mutateAsync(password)).recovery_codes)}
      />
    </Section>
  );
}

function RecoveryCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const text = codes?.join("\n") ?? "";
  return (
    <Dialog open={!!codes} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Save your recovery codes</DialogTitle>
          <DialogDescription>
            If you lose your app and keys, each of these signs you in once. This is the only time
            they're shown.
          </DialogDescription>
        </DialogHeader>
        <ol className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-muted p-4 font-mono text-sm">
          {codes?.map((code) => (
            <li key={code} className="select-all">
              {code}
            </li>
          ))}
        </ol>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(text)
                  .then(() => toast.success("Copied"))
                  .catch(() => toast.error("Couldn't copy; select them instead"))
              }
            >
              <Copy /> Copy
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const link = document.createElement("a");
                link.href = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }));
                link.download = "rent-tracker-recovery-codes.txt";
                link.click();
                URL.revokeObjectURL(link.href);
              }}
            >
              <Download /> Download
            </Button>
          </div>
          <Button onClick={onClose}>I've saved them</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- dialogs --------------------------------------------------------------------------------

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submit,
  pending,
  error,
  destructive,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submit: string;
  pending: boolean;
  error?: string | null;
  destructive?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) onSubmit();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form id="security-form" className="grid gap-4" onSubmit={send}>
          {children}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="security-form"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
          >
            {submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Your password" htmlFor="confirm-password" hint="To confirm it's you.">
      <Input
        id="confirm-password"
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </Field>
  );
}

/** Changes to 2FA, other than renaming a key, take the password. */
function PasswordDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  destructive,
  mutation,
  onConfirm,
  done,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  destructive?: boolean;
  mutation: { isPending: boolean; error: Error | null; reset: () => void };
  onConfirm: (password: string) => Promise<unknown>;
  done?: () => void;
}) {
  const [password, setPassword] = useState("");
  const change = (value: boolean) => {
    if (!value) {
      setPassword("");
      mutation.reset();
    }
    onOpenChange(value);
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={change}
      title={title}
      description={description}
      submit={confirm}
      pending={mutation.isPending}
      error={mutation.error?.message}
      destructive={destructive}
      onSubmit={() =>
        void onConfirm(password)
          .then(() => {
            done?.();
            change(false);
          })
          .catch(() => {})
      }
    >
      <PasswordField value={password} onChange={setPassword} />
    </FormDialog>
  );
}
