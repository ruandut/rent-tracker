import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, Plus, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CrudDialog, useCrudDialog } from "@/components/crud-dialog";
import { Field, NativeSelect } from "@/components/form";
import { EmptyState, Page, TableSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, useAll, useRemove, useSave } from "@/lib/api";
import { formatDateTime, today } from "@/lib/format";
import {
  SUMMARY_FREQUENCIES,
  type DeliverySettings,
  type SummaryChannel,
  type SummaryFrequency,
  type SummarySchedule,
} from "@/lib/types";

export const Route = createFileRoute("/_app/summaries/")({
  component: SummariesPage,
});

type Form = {
  name: string;
  channel: SummaryChannel;
  recipient: string;
  frequency: SummaryFrequency;
  start_at: string;
  is_enabled: boolean;
};

const toForm = (row?: SummarySchedule): Form => ({
  name: row?.name ?? "",
  channel: row?.channel ?? "email",
  recipient: row?.recipient ?? "",
  frequency: row?.frequency ?? "monthly",
  // The API returns local time with an offset; a datetime-local input wants it without.
  start_at: row ? row.start_at.slice(0, 16) : `${today()}T08:00`,
  is_enabled: row?.is_enabled ?? true,
});

function SummariesPage() {
  const { data: rows, isPending } = useAll<SummarySchedule>("notifications/schedules");
  const dialog = useCrudDialog<SummarySchedule, Form>(toForm);
  const save = useSave<Form & { id?: number }>("notifications/schedules", "Summary");
  const remove = useRemove("notifications/schedules", "Summary");
  const { form, set, editing } = dialog;
  const isEmail = form.channel === "email";

  return (
    <Page
      title="Summaries"
      description="Get the account balance and totals to date, by email or Telegram, on a schedule."
      actions={
        <Button onClick={() => dialog.openNew()}>
          <Plus /> Add summary
        </Button>
      }
    >
      {isPending && !rows ? (
        <TableSkeleton rows={3} />
      ) : rows?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Summary</TableHead>
                <TableHead className="hidden md:table-cell">Repeats</TableHead>
                <TableHead>Next send</TableHead>
                <TableHead className="hidden lg:table-cell">Last sent</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => dialog.openEdit(row)}
                >
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.channel === "email" ? "Email" : "Telegram"} · {row.recipient}
                    </div>
                    {row.last_error && (
                      <div className="mt-1 text-xs text-destructive">{row.last_error}</div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {SUMMARY_FREQUENCIES[row.frequency]}
                  </TableCell>
                  <TableCell>
                    {row.is_enabled && row.next_run_at ? (
                      formatDateTime(row.next_run_at)
                    ) : (
                      <Badge variant="outline">Off</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {row.last_sent_at ? formatDateTime(row.last_sent_at) : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <TestButton id={row.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No summaries yet">
          Set up email or Telegram below, then add your first summary.
        </EmptyState>
      )}

      <DeliveryForm />

      <CrudDialog
        open={dialog.open}
        onOpenChange={(open) => {
          dialog.setOpen(open);
          if (!open) save.reset();
        }}
        title={editing ? "Edit summary" : "Add summary"}
        onSubmit={() =>
          save.mutate({ id: editing?.id, ...form }, { onSuccess: () => dialog.setOpen(false) })
        }
        saving={save.isPending}
        error={save.error?.message}
        onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        deleteLabel={editing?.name}
      >
        <Field label="Name" htmlFor="s-name">
          <Input
            id="s-name"
            required
            placeholder="Month-end summary"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Send by" htmlFor="s-channel">
            <NativeSelect
              id="s-channel"
              value={form.channel}
              onChange={(e) => set("channel", e.target.value as SummaryChannel)}
            >
              <option value="email">Email</option>
              <option value="telegram">Telegram</option>
            </NativeSelect>
          </Field>
          <Field
            label={isEmail ? "Email address" : "Telegram chat ID"}
            htmlFor="s-recipient"
            hint={isEmail ? undefined : "Bots can't message phone numbers. See the steps below."}
          >
            <Input
              id="s-recipient"
              required
              type={isEmail ? "email" : "text"}
              placeholder={isEmail ? "you@example.com" : "123456789"}
              value={form.recipient}
              onChange={(e) => set("recipient", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First send" htmlFor="s-start">
            <Input
              id="s-start"
              type="datetime-local"
              required
              value={form.start_at}
              onChange={(e) => set("start_at", e.target.value)}
            />
          </Field>
          <Field label="Repeats" htmlFor="s-frequency">
            <NativeSelect
              id="s-frequency"
              value={form.frequency}
              onChange={(e) => set("frequency", e.target.value as SummaryFrequency)}
            >
              {Object.entries(SUMMARY_FREQUENCIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={form.is_enabled}
            onChange={(e) => set("is_enabled", e.target.checked)}
          />
          On
        </label>
      </CrudDialog>
    </Page>
  );
}

function TestButton({ id }: { id: number }) {
  const test = useMutation({
    mutationFn: () =>
      api<{ sent: boolean; error: string }>(`/api/notifications/schedules/${id}/test/`, {
        method: "POST",
      }),
    onSuccess: (result) =>
      result.sent ? toast.success("Summary sent") : toast.error(result.error),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={test.isPending}
      onClick={(e) => {
        e.stopPropagation();
        test.mutate();
      }}
    >
      <Send /> {test.isPending ? "Sending…" : "Send now"}
    </Button>
  );
}

type DeliveryFormState = {
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  from_email: string;
  telegram_bot_token: string;
};

// Saved credentials never come back from the API, so those two inputs always start empty.
const toDeliveryForm = (saved: DeliverySettings): DeliveryFormState => ({
  smtp_host: saved.smtp_host,
  smtp_port: String(saved.smtp_port),
  smtp_username: saved.smtp_username,
  smtp_password: "",
  smtp_use_tls: saved.smtp_use_tls,
  from_email: saved.from_email,
  telegram_bot_token: "",
});

function DeliveryForm() {
  const { data } = useQuery({
    queryKey: ["notifications/settings"],
    queryFn: () => api<DeliverySettings>("/api/notifications/settings/"),
  });
  return data ? <DeliveryFields saved={data} /> : null;
}

function DeliveryFields({ saved }: { saved: DeliverySettings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => toDeliveryForm(saved));
  const set = <K extends keyof DeliveryFormState>(key: K, value: DeliveryFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      api<DeliverySettings>("/api/notifications/settings/", {
        method: "PATCH",
        body: JSON.stringify(form),
      }),
    onSuccess: (updated) => {
      toast.success("Delivery settings saved");
      queryClient.setQueryData(["notifications/settings"], updated);
      setForm(toDeliveryForm(updated));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={submit}>
      <section className="grid content-start gap-4 rounded-xl border p-4">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <Mail className="size-4" /> Email
          </h3>
          <p className="text-sm text-muted-foreground">
            The mail server used to send. Your email provider lists these as SMTP settings.
          </p>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label="SMTP server" htmlFor="d-host">
            <Input
              id="d-host"
              placeholder="smtp.gmail.com"
              value={form.smtp_host}
              onChange={(e) => set("smtp_host", e.target.value)}
            />
          </Field>
          <Field label="Port" htmlFor="d-port">
            <Input
              id="d-port"
              type="number"
              min="1"
              max="65535"
              value={form.smtp_port}
              onChange={(e) => set("smtp_port", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Send from" htmlFor="d-from">
          <Input
            id="d-from"
            type="email"
            value={form.from_email}
            onChange={(e) => set("from_email", e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username" htmlFor="d-user">
            <Input
              id="d-user"
              autoComplete="off"
              value={form.smtp_username}
              onChange={(e) => set("smtp_username", e.target.value)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="d-password"
            hint={saved.has_smtp_password ? "Saved. Leave blank to keep it." : undefined}
          >
            <Input
              id="d-password"
              type="password"
              autoComplete="new-password"
              value={form.smtp_password}
              onChange={(e) => set("smtp_password", e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={form.smtp_use_tls}
            onChange={(e) => set("smtp_use_tls", e.target.checked)}
          />
          Use TLS
        </label>
      </section>

      <section className="grid content-start gap-4 rounded-xl border p-4">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <Send className="size-4" /> Telegram
          </h3>
          <p className="text-sm text-muted-foreground">
            Bots can't message a phone number, so summaries go to a chat ID.
          </p>
        </div>
        <Field
          label="Bot token"
          htmlFor="d-token"
          hint={saved.has_telegram_bot_token ? "Saved. Leave blank to keep it." : undefined}
        >
          <Input
            id="d-token"
            type="password"
            autoComplete="off"
            placeholder="123456789:AA..."
            value={form.telegram_bot_token}
            onChange={(e) => set("telegram_bot_token", e.target.value)}
          />
        </Field>
        <ol className="grid list-decimal gap-1 pl-4 text-sm text-muted-foreground">
          <li>In Telegram, message @BotFather, send /newbot, and paste the token here.</li>
          <li>Open your new bot and press Start. A bot can't message you until you do.</li>
          <li>Message @userinfobot to get your chat ID, and use it on a summary.</li>
          <li>For a group, add the bot to it. Group IDs are negative, like -1001234567890.</li>
        </ol>
      </section>

      <div className="lg:col-span-2">
        {save.error && <p className="mb-2 text-sm text-destructive">{save.error.message}</p>}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save delivery settings"}
        </Button>
      </div>
    </form>
  );
}
