import { Link, useMatchRoute } from "@tanstack/react-router";
import { Building } from "lucide-react";
import { Fragment, useEffect, type ReactNode } from "react";

import { EmptyState, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/api";
import { useRealm } from "@/stores/realm";

import { enterRealm } from "./use-realms";

/**
 * Settles which realm this tab works in before any realm data loads, and shows the way in when
 * there is none. The realm screens and Security work without one, so they always render.
 *
 * The page is keyed by the realm, so switching remounts it and nothing from the old realm can
 * linger on screen (not even as placeholder data while the new realm loads).
 */
export function RealmGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const realmId = useRealm((s) => s.realmId);
  const matchRoute = useMatchRoute();
  // Realm screens, and Security (2FA belongs to the account, not a realm).
  const onRealmScreens =
    !!matchRoute({ to: "/realms", fuzzy: true }) || !!matchRoute({ to: "/security" });
  const current = me.data?.realm?.id ?? null;

  useEffect(() => {
    if (!me.data) return;
    // No realm chosen in this tab yet: take the server's. Or the chosen one is gone: forget it,
    // which refetches /me without the header. Either way, drop anything cached from before.
    if (realmId === null ? current !== null : current !== realmId) enterRealm(current);
  }, [me.data, current, realmId]);

  if (onRealmScreens) return children;
  if (me.data && !me.data.realm && !me.data.realms.length) return <NoRealm />;
  if (realmId === null || current !== realmId) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <TableSkeleton />
      </div>
    );
  }
  return <Fragment key={realmId}>{children}</Fragment>;
}

function NoRealm() {
  const me = useMe();
  const invites = me.data?.pending_invitations ?? 0;
  return (
    <div className="mx-auto grid w-full max-w-xl gap-4 p-4 md:p-6">
      <EmptyState title="You're not in a realm yet">
        <p>
          A realm is one set of books: its rental units, accounts, bills and the people who share
          them.
          {invites > 0 && ` You have ${invites} invitation${invites === 1 ? "" : "s"} waiting.`}
        </p>
        <Button asChild className="mt-4">
          <Link to="/realms">
            <Building /> {invites > 0 ? "See invitations" : "Create a realm"}
          </Link>
        </Button>
      </EmptyState>
    </div>
  );
}
