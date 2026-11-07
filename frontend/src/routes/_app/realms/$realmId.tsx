import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, LogOut, MoreHorizontal, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CrudDialog } from "@/components/crud-dialog";
import { Field, NativeSelect } from "@/components/form";
import { EmptyState, flexCell, Page, TableSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { enterRealm } from "@/features/realms/use-realms";
import { api, useMe } from "@/lib/api";
import type { Realm, RealmInvitation, RealmMember, RealmRole } from "@/lib/types";

export const Route = createFileRoute("/_app/realms/$realmId")({
  staticData: { title: "Realm" },
  component: RealmPage,
});

function useRealmQueries(realmId: string, isAdmin: boolean) {
  const base = `/api/realms/${realmId}/`;
  return {
    members: useQuery({
      queryKey: ["realms", realmId, "members"],
      queryFn: () => api<RealmMember[]>(`${base}members/`),
    }),
    invitations: useQuery({
      queryKey: ["realms", realmId, "invitations"],
      queryFn: () => api<RealmInvitation[]>(`${base}invitations/`),
      enabled: isAdmin,
    }),
  };
}

/** A mutation on this realm that refreshes everything after it and reports errors. */
function useRealmAction<Vars, Result = unknown>(
  fn: (vars: Vars) => Promise<Result>,
  success?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (success) toast.success(success);
      void queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
}

function RealmPage() {
  const { realmId } = Route.useParams();
  const me = useMe();
  const realm = useQuery({
    queryKey: ["realms", realmId],
    queryFn: () => api<Realm>(`/api/realms/${realmId}/`),
  });
  const isAdmin = realm.data?.role === "admin";
  const { members, invitations } = useRealmQueries(realmId, isAdmin);
  const [dialog, setDialog] = useState<"invite" | "rename" | "leave" | "delete" | null>(null);

  if (!realm.data) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        {realm.isPending ? <TableSkeleton rows={3} /> : <EmptyState title="Realm not found" />}
      </div>
    );
  }

  const myId = me.data?.id;
  const admins = members.data?.filter((m) => m.role === "admin") ?? [];
  const close = () => setDialog(null);

  return (
    <Page
      description={`${realm.data.name} · you're ${isAdmin ? "an admin" : "a member"}.`}
      actions={
        isAdmin && (
          <>
            <Button variant="outline" onClick={() => setDialog("rename")}>
              <Pencil /> Rename
            </Button>
            <Button onClick={() => setDialog("invite")}>
              <UserPlus /> Invite
            </Button>
          </>
        )
      }
    >
      <Section title="Members">
        {members.isPending && !members.data ? (
          <TableSkeleton rows={2} />
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  {isAdmin && (
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data?.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className={`${flexCell} font-medium`}>
                      {member.username}
                      {member.id === myId && (
                        <span className="font-normal text-muted-foreground"> (you)</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate text-muted-foreground sm:table-cell">
                      {member.email || "—"}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={member.role} />
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="py-1">
                        {member.id !== myId && <MemberMenu realmId={realmId} member={member} />}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {isAdmin && !!invitations.data?.length && (
        <Section title="Pending invitations">
          <div className="rounded-xl border">
            <Table>
              <TableBody>
                {invitations.data.map((invitation) => (
                  <InvitationRow key={invitation.id} realmId={realmId} invitation={invitation} />
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      <Section title="Leave or delete">
        <div className="flex flex-wrap gap-2 rounded-xl border p-4">
          <p className="w-full text-sm text-muted-foreground">
            Leaving keeps the realm and its data for everyone else. Deleting removes the realm and
            all of its units, transactions, bills and summaries for every member.
          </p>
          <Button variant="outline" onClick={() => setDialog("leave")}>
            <LogOut /> Leave realm
          </Button>
          {isAdmin && (
            <Button variant="destructive" onClick={() => setDialog("delete")}>
              <Trash2 /> Delete realm
            </Button>
          )}
        </div>
      </Section>

      <InviteDialog realmId={realmId} open={dialog === "invite"} onClose={close} />
      <RenameDialog realm={realm.data} open={dialog === "rename"} onClose={close} />
      <LeaveDialog
        realm={realm.data}
        open={dialog === "leave"}
        onClose={close}
        others={members.data?.filter((m) => m.id !== myId) ?? []}
        mustHandOver={isAdmin && admins.length === 1}
      />
      <DeleteDialog realm={realm.data} open={dialog === "delete"} onClose={close} />
    </Page>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function RoleBadge({ role }: { role: RealmRole }) {
  return (
    <Badge variant={role === "admin" ? "secondary" : "outline"}>
      {role === "admin" ? "Admin" : "Member"}
    </Badge>
  );
}

function MemberMenu({ realmId, member }: { realmId: string; member: RealmMember }) {
  const url = `/api/realms/${realmId}/members/${member.id}/`;
  const setRole = useRealmAction(
    (role: RealmRole) => api(url, { method: "PATCH", body: JSON.stringify({ role }) }),
    "Role updated",
  );
  const remove = useRealmAction(() => api(url, { method: "DELETE" }), `${member.username} removed`);
  const next = member.role === "admin" ? "member" : "admin";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Member actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setRole.mutate(next)}>
          Make {next === "admin" ? "an admin" : "a member"}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(undefined)}>
          Remove from realm
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Invite link copied");
  } catch {
    toast.error("Couldn't copy. Select the link and copy it yourself.");
  }
}

function InvitationRow({ realmId, invitation }: { realmId: string; invitation: RealmInvitation }) {
  const cancel = useRealmAction(
    () => api(`/api/realms/${realmId}/invitations/${invitation.id}/`, { method: "DELETE" }),
    "Invitation cancelled",
  );
  return (
    <TableRow>
      <TableCell className={`${flexCell} font-medium`}>{invitation.email}</TableCell>
      <TableCell className="hidden sm:table-cell">
        <RoleBadge role={invitation.role} />
      </TableCell>
      <TableCell className="py-1 text-right whitespace-nowrap">
        {invitation.link && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => void copyLink(invitation.link!)}
          >
            <Copy /> <span className="hidden sm:inline">Copy link</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Cancel invitation"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(undefined)}
        >
          <X />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function InviteDialog({
  realmId,
  open,
  onClose,
}: {
  realmId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RealmRole>("member");
  const [sent, setSent] = useState<RealmInvitation | null>(null);
  const invite = useRealmAction((body: { email: string; role: RealmRole }) =>
    api<RealmInvitation>(`/api/realms/${realmId}/invitations/`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  const reset = () => {
    setEmail("");
    setRole("member");
    setSent(null);
    invite.reset();
    onClose();
  };

  if (sent) {
    return (
      <Dialog open={open} onOpenChange={(value) => !value && reset()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invitation for {sent.email}</DialogTitle>
            <DialogDescription>
              {sent.email_sent
                ? "We emailed them. You can also send them this link yourself."
                : "Email isn't set up on this server, so send them this link yourself."}
            </DialogDescription>
          </DialogHeader>
          {sent.link && (
            <div className="flex min-w-0 gap-2">
              <Input readOnly value={sent.link} onFocus={(e) => e.target.select()} />
              <Button variant="outline" onClick={() => void copyLink(sent.link!)}>
                <Copy /> Copy
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={reset}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <CrudDialog
      open={open}
      onOpenChange={(value) => !value && reset()}
      title="Invite someone"
      description="They get a link to create an account, or see the invitation under Realms if they already have one."
      onSubmit={() => invite.mutate({ email, role }, { onSuccess: (data) => setSent(data) })}
      saving={invite.isPending}
      error={invite.error?.message}
    >
      <Field label="Email" htmlFor="invite-email">
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field
        label="Role"
        htmlFor="invite-role"
        hint="Admins can invite people, change roles, delivery settings and delete the realm."
      >
        <NativeSelect
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as RealmRole)}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </NativeSelect>
      </Field>
    </CrudDialog>
  );
}

function RenameDialog({
  realm,
  open,
  onClose,
}: {
  realm: Realm;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(realm.name);
  const rename = useRealmAction(
    () => api(`/api/realms/${realm.id}/`, { method: "PATCH", body: JSON.stringify({ name }) }),
    "Realm renamed",
  );
  return (
    <CrudDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          rename.reset();
          onClose();
        }
      }}
      title="Rename realm"
      onSubmit={() => rename.mutate(undefined, { onSuccess: onClose })}
      saving={rename.isPending}
      error={rename.error?.message}
    >
      <Field label="Name" htmlFor="realm-rename">
        <Input id="realm-rename" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </CrudDialog>
  );
}

/** After leaving or deleting: back to the realm list, and off this realm if the tab was on it. */
function useGone(realm: Realm) {
  const navigate = useNavigate();
  const me = useMe();
  return () => {
    if (me.data?.realm?.id === realm.id) enterRealm(null);
    void navigate({ to: "/realms" });
  };
}

function LeaveDialog({
  realm,
  open,
  onClose,
  others,
  mustHandOver,
}: {
  realm: Realm;
  open: boolean;
  onClose: () => void;
  others: RealmMember[];
  mustHandOver: boolean;
}) {
  const [newAdmin, setNewAdmin] = useState("");
  const gone = useGone(realm);
  const leave = useRealmAction(
    () =>
      api(`/api/realms/${realm.id}/leave/`, {
        method: "POST",
        body: JSON.stringify(newAdmin ? { new_admin: Number(newAdmin) } : {}),
      }),
    `You left ${realm.name}`,
  );
  const alone = others.length === 0;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Leave {realm.name}?</DialogTitle>
          <DialogDescription>
            {alone
              ? "You're its only member, so there's nobody to leave it to. Delete it instead if you're done with it."
              : "You'll lose access to its books until someone invites you again."}
          </DialogDescription>
        </DialogHeader>
        {!alone && mustHandOver && (
          <Field label="Who takes over as admin?" htmlFor="new-admin">
            <NativeSelect
              id="new-admin"
              value={newAdmin}
              onChange={(e) => setNewAdmin(e.target.value)}
            >
              <option value="">Choose someone…</option>
              {others.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.username}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {leave.error && <p className="text-sm text-destructive">{leave.error.message}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={alone || (mustHandOver && !newAdmin) || leave.isPending}
            onClick={() =>
              leave.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  gone();
                },
              })
            }
          >
            <LogOut /> Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  realm,
  open,
  onClose,
}: {
  realm: Realm;
  open: boolean;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const gone = useGone(realm);
  const remove = useRealmAction(
    () => api(`/api/realms/${realm.id}/`, { method: "DELETE", body: JSON.stringify({ confirm }) }),
    `${realm.name} deleted`,
  );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {realm.name}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the realm and everything in it, for every member. It can't be
            undone.
          </DialogDescription>
        </DialogHeader>
        <Field label={`Type "${realm.name}" to confirm`} htmlFor="confirm-delete">
          <Input
            id="confirm-delete"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {remove.error && <p className="text-sm text-destructive">{remove.error.message}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirm.trim() !== realm.name || remove.isPending}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  gone();
                },
              })
            }
          >
            <Trash2 /> Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
