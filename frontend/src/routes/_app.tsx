import { createFileRoute, Outlet, redirect, useMatches } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
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
  const title = useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.title)?.staticData.title,
  });

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
          />
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
          <ThemeToggle />
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
