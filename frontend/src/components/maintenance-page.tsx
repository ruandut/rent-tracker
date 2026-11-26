import { RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { checkMaintenanceOver } from "@/lib/maintenance";
import { useMaintenance } from "@/stores/maintenance";

const CHECK_EVERY_SECONDS = 5;

/** Shown in place of the whole app while the server is down for a rollback. */
export function MaintenancePage() {
  const detail = useMaintenance((s) => s.detail);
  const [seconds, setSeconds] = useState(CHECK_EVERY_SECONDS);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const left = useRef(CHECK_EVERY_SECONDS);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    if (await checkMaintenanceOver()) return; // The app reloads.
    busy.current = false;
    left.current = CHECK_EVERY_SECONDS;
    setChecking(false);
    setSeconds(CHECK_EVERY_SECONDS);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (busy.current) return;
      left.current -= 1;
      if (left.current <= 0) void check();
      else setSeconds(left.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [check]);

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <main className="w-full max-w-md text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Wrench aria-hidden className="size-6" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">We'll be right back</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {detail ?? "Rent Tracker is down for maintenance. It will be back shortly."}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          This page comes back by itself when it's done. Changes you hadn't saved may need to be
          made again.
        </p>
        <div
          role="status"
          aria-live="polite"
          className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground tabular-nums"
        >
          {checking ? "Checking…" : `Checking again in ${seconds}s`}
          <Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>
            <RefreshCw aria-hidden className={checking ? "animate-spin" : undefined} />
            Check now
          </Button>
        </div>
      </main>
    </div>
  );
}
