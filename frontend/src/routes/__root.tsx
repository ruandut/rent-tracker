import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { MaintenancePage } from "@/components/maintenance-page";
import { useMaintenance } from "@/stores/maintenance";

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

/** The whole app, or the maintenance page while the server is down for a rollback. */
function Root() {
  const maintenance = useMaintenance((s) => s.active);
  return maintenance ? <MaintenancePage /> : <Outlet />;
}
