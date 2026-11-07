import { useQueryClient } from "@tanstack/react-query";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Building,
  Building2,
  Check,
  ChevronsUpDown,
  CreditCard,
  Droplets,
  Home,
  Landmark,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Plus,
  ReceiptText,
  Send,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSwitchRealm } from "@/features/realms/use-realms";
import { useMe } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useRealm } from "@/stores/realm";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: "invitations";
};

const MONEY: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", label: "Expense tracking", icon: ArrowLeftRight },
];
const PROPERTY: NavItem[] = [
  { to: "/bills", label: "Municipal bills", icon: ReceiptText },
  { to: "/utilities", label: "Water & electricity", icon: Droplets },
  { to: "/charges", label: "Rates & taxes", icon: Landmark },
  { to: "/units", label: "Rental units", icon: Building2 },
];
const SETUP: NavItem[] = [
  { to: "/templates", label: "Municipal templates", icon: LayoutTemplate },
  { to: "/payment-methods", label: "Payment methods", icon: CreditCard },
  { to: "/beneficiaries", label: "Beneficiaries", icon: Users },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/summaries", label: "Summaries", icon: Send },
  { to: "/realms", label: "Realms", icon: Building, badge: "invitations" },
];

/** On a phone the sidebar is a drawer over the page, so choosing a link should dismiss it. */
function useCloseOnMobile() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <RealmSwitcher />
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

/** The current realm, and a menu to switch to another, manage them or start a new one. */
function RealmSwitcher() {
  const me = useMe();
  const switchRealm = useSwitchRealm();
  const closeOnMobile = useCloseOnMobile();
  const navigate = useNavigate();
  const realm = me.data?.realm;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={realm?.name ?? "Realms"}>
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
                <Home className="size-4" />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{realm?.name ?? "Rent Tracker"}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {realm ? (realm.role === "admin" ? "Admin" : "Member") : "No realm yet"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Realms</DropdownMenuLabel>
            {me.data?.realms.map((option) => (
              <DropdownMenuItem
                key={option.id}
                disabled={switchRealm.isPending}
                onClick={() => {
                  closeOnMobile();
                  if (option.id !== realm?.id) switchRealm.mutate(option);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.id === realm?.id && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                closeOnMobile();
                void navigate({ to: "/realms", search: { create: true } });
              }}
            >
              <Plus /> New realm
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                closeOnMobile();
                void navigate({ to: "/realms" });
              }}
            >
              <Building /> Manage realms
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const matchRoute = useMatchRoute();
  const closeOnMobile = useCloseOnMobile();
  const invitations = useMe().data?.pending_invitations ?? 0;
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
                <Link to={item.to} onClick={closeOnMobile}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
              {item.badge === "invitations" && invitations > 0 && (
                <SidebarMenuBadge>{invitations}</SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function UserMenu() {
  const me = useMe();
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
                useRealm.getState().setRealmId(null);
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
