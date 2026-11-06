import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Building2,
  ChevronsUpDown,
  CreditCard,
  Droplets,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Send,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { api, type Me } from "@/lib/api";
import { useAuth } from "@/stores/auth";

type NavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean };

const MONEY: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", label: "Expense tracking", icon: ArrowLeftRight },
];
const PROPERTY: NavItem[] = [
  { to: "/utilities", label: "Water & electricity", icon: Droplets },
  { to: "/charges", label: "Rates & taxes", icon: Landmark },
  { to: "/units", label: "Rental units", icon: Building2 },
];
const SETUP: NavItem[] = [
  { to: "/payment-methods", label: "Payment methods", icon: CreditCard },
  { to: "/beneficiaries", label: "Beneficiaries", icon: Users },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/summaries", label: "Summaries", icon: Send },
];

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-emerald-600 text-white">
                  <Home className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Rent Tracker</span>
                  <span className="truncate text-xs text-muted-foreground">Rental account</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Money" items={MONEY} />
        <NavGroup label="Property" items={PROPERTY} />
        <NavGroup label="Setup" items={SETUP} />
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const matchRoute = useMatchRoute();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                asChild
                isActive={!!matchRoute({ to: item.to, fuzzy: !item.exact })}
                tooltip={item.label}
              >
                <Link to={item.to}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function UserMenu() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me/") });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="flex size-8 items-center justify-center rounded-md bg-muted font-medium uppercase">
                {me.data?.username.slice(0, 2) ?? "··"}
              </div>
              <span className="truncate font-medium">{me.data?.username ?? "…"}</span>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem
              onClick={() => {
                useAuth.getState().clear();
                queryClient.clear();
                void navigate({ to: "/login" });
              }}
            >
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
