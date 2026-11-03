import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { FilterBar } from "@/components/filter-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { isLoggedIn } from "@/stores/auth";

// Pathless layout: every signed-in page renders inside the sidebar, under the shared filters.
export const Route = createFileRoute("/_app")({
  beforeLoad: () => {
    if (!isLoggedIn()) throw redirect({ to: "/login" });
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex min-h-14 shrink-0 items-start gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <SidebarTrigger className="mt-0.5 -ml-1" />
          <Separator orientation="vertical" className="mt-2 mr-1 data-[orientation=vertical]:h-4" />
          <div className="min-w-0 flex-1">
            <FilterBar />
          </div>
          <div className="shrink-0">
            <ThemeToggle />
          </div>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
