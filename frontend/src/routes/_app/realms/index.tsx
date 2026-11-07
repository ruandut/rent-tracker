import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Mail, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CrudDialog } from "@/components/crud-dialog";
import { Field } from "@/components/form";
import { EmptyState, flexCell, Page, TableSkeleton } from "@/components/page";
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
import { enterRealm, useSwitchRealm } from "@/features/realms/use-realms";
import { api, useMe } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Realm, ReceivedInvitation } from "@/lib/types";

export const Route = createFileRoute("/_app/realms/")({
  staticData: { title: "Realms" },
  validateSearch: (search: Record<string, unknown>): { create?: boolean } =>
    search.create ? { create: true } : {},
  component: RealmsPage,
});

function RealmsPage() {
  const { create } = Route.useSearch();
  const navigate = useNavigate();
  const me = useMe();
  const realms = useQuery({ queryKey: ["realms"], queryFn: () => api<Realm[]>("/api/realms/") });
  const switchRealm = useSwitchRealm();
  const [creating, setCreating] = useState(false);
  const open = creating || !!create;
  const setOpen = (value: boolean) => {
    setCreating(value);
    if (!value && create) void navigate({ to: "/realms", search: {}, replace: true });
  };
  const currentId = me.data?.realm?.id;

  return (
    <Page
      description="Each realm is a separate set of books, shared with the people you invite."
      actions={
        <Button onClick={() => setOpen(true)}>
          <Plus /> New realm
        </Button>
      }
    >
      <ReceivedInvitations />
      {realms.isPending && !realms.data ? (
        <TableSkeleton rows={2} />
      ) : realms.data?.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Members</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Switch</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {realms.data.map((realm) => (
                <TableRow
                  key={realm.id}
                  className="cursor-pointer"
                  onClick={() =>
                    void navigate({
                      to: "/realms/$realmId",
                      params: { realmId: String(realm.id) },
                    })
                  }
                >
                  <TableCell className={`${flexCell} font-medium`}>{realm.name}</TableCell>
                  <TableCell>
                    <Badge variant={realm.role === "admin" ? "secondary" : "outline"}>
                      {realm.role === "admin" ? "Admin" : "Member"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {realm.member_count}
                  </TableCell>
                  <TableCell className="text-right">
                    {realm.id === currentId ? (
                      <span className="inline-flex h-7 items-center gap-1 text-sm text-muted-foreground">
                        <Check className="size-4" /> Current
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={switchRealm.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          switchRealm.mutate(realm);
                        }}
                      >
                        Switch
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="You're not in any realm">
          Create one for your own books, or ask someone to invite you to theirs.
        </EmptyState>
      )}
      <CreateRealmDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

function CreateRealmDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () =>
      api<Realm>("/api/realms/", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (realm) => {
      onOpenChange(false);
      setName("");
      toast.success(`${realm.name} created`);
      // The server focused the new realm; follow it in this tab.
      enterRealm(realm.id);
      void navigate({ to: "/" });
    },
  });
  return (
    <CrudDialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) create.reset();
      }}
      title="New realm"
      description="It starts empty, with the George municipal template and a maintenance tag. You'll be its admin."
      onSubmit={() => create.mutate()}
      saving={create.isPending}
      error={create.error?.message}
    >
      <Field label="Name" htmlFor="realm-name">
        <Input
          id="realm-name"
          required
          placeholder="Beach house, Mom's flats…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </CrudDialog>
  );
}

function ReceivedInvitations() {
  const queryClient = useQueryClient();
  const received = useQuery({
    queryKey: ["realms", "received"],
    queryFn: () => api<ReceivedInvitation[]>("/api/realms/received/"),
  });
  const answer = useMutation({
    mutationFn: ({ id, accept }: { id: number; accept: boolean }) =>
      api<Realm | null>(`/api/realms/received/${id}/${accept ? "accept" : "reject"}/`, {
        method: "POST",
      }),
    onSuccess: (realm, { accept }) => {
      if (accept && realm) {
        toast.success(`You joined ${realm.name}`);
        enterRealm(realm.id);
      } else {
        toast.success("Invitation declined");
      }
      void queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });

  if (!received.data?.length) return null;
  return (
    <div className="grid gap-2">
      <h2 className="text-sm font-medium">Invitations</h2>
      {received.data.map((invitation) => (
        <div
          key={invitation.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
        >
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{invitation.realm_name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {invitation.invited_by ? `From ${invitation.invited_by}` : "Invitation"} · as{" "}
              {invitation.role === "admin" ? "an admin" : "a member"} ·{" "}
              {formatDate(invitation.created_at.slice(0, 10))}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: invitation.id, accept: false })}
            >
              <X /> Decline
            </Button>
            <Button
              size="sm"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: invitation.id, accept: true })}
            >
              <Check /> Accept
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
