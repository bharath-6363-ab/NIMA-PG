import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  BedDouble,
  Bell,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  ExternalLink,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareWarning,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  User,
  UserPlus,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";
import brandMark from "@/assets/brand-mark.svg";
import { Badge } from "@/components/ui/Badge";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/shared/ToastProvider";
import { roleHomePath, useAuth } from "@/context/AuthContext";
import { useHealthStatus } from "@/hooks/useHealthStatus";
import { cn, formatDateTime } from "@/lib/utils";
import {
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/complaintService";
import { NotificationItem, UserRole } from "@/types/api";

interface NavItem {
  to: string;
  label: string;
  section: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  keywords?: string;
}

function getNavItemsForRole(role: UserRole): NavItem[] {
  if (role === "owner") {
    return [
      { to: "/owner", label: "Owner Dashboard", section: "Overview", icon: LayoutDashboard, end: true, keywords: "home analytics revenue summary" },
      { to: "/owner/reports", label: "Financial Reports", section: "Finance", icon: BarChart3, keywords: "csv pdf ledger statements" },
      { to: "/rent-management", label: "Rent & Payments", section: "Finance", icon: Receipt, keywords: "invoices billing collections" },
      { to: "/deposits", label: "Security Deposits", section: "Finance", icon: Wallet, keywords: "refunds deductions held" },
      { to: "/vacancies", label: "Vacancy Board", section: "Operations", icon: Home, keywords: "public links sharing availability" },
      { to: "/rooms", label: "Rooms", section: "Operations", icon: DoorOpen, keywords: "floors inventory rooms" },
      { to: "/beds", label: "Beds", section: "Operations", icon: BedDouble, keywords: "beds occupancy status" },
      { to: "/tenants", label: "Tenants", section: "Operations", icon: Users, end: true, keywords: "residents directory kyc" },
      { to: "/tenants/new", label: "Register Tenant", section: "Operations", icon: UserPlus, keywords: "onboarding checkin allocate" },
      { to: "/complaints", label: "Complaints", section: "Services", icon: MessageSquareWarning, keywords: "tickets issues maintenance" },
      { to: "/food-management", label: "Food & Menu", section: "Services", icon: UtensilsCrossed, keywords: "meals skips ratings weekly menu" },
      { to: "/owner/users", label: "Users & Managers", section: "Admin", icon: ShieldCheck, keywords: "staff roles permissions" },
      { to: "/owner/settings", label: "PG Settings", section: "Admin", icon: Settings, keywords: "property configuration defaults timings" },
      { to: "/system-health", label: "API & DB Health", section: "Admin", icon: Activity, keywords: "status diagnostics health" },
    ];
  }
  if (role === "manager") {
    return [
      { to: "/manager", label: "Manager Workspace", section: "Overview", icon: LayoutDashboard, end: true, keywords: "home summary operations" },
      { to: "/vacancies", label: "Vacancy Board", section: "Operations", icon: Home, keywords: "available beds maintenance" },
      { to: "/rooms", label: "Rooms", section: "Operations", icon: DoorOpen, keywords: "rooms inventory" },
      { to: "/beds", label: "Beds", section: "Operations", icon: BedDouble, keywords: "beds status" },
      { to: "/tenants", label: "Tenants", section: "Operations", icon: Users, end: true, keywords: "residents directory" },
      { to: "/tenants/new", label: "Register Tenant", section: "Operations", icon: UserPlus, keywords: "onboarding checkin" },
      { to: "/rent-management", label: "Rent & Payments", section: "Finance", icon: Receipt, keywords: "rent collection receipts" },
      { to: "/deposits", label: "Security Deposits", section: "Finance", icon: Wallet, keywords: "deposits deductions" },
      { to: "/complaints", label: "Complaints", section: "Services", icon: MessageSquareWarning, keywords: "tickets issues" },
      { to: "/food-management", label: "Food & Menu", section: "Services", icon: UtensilsCrossed, keywords: "meals skips ratings" },
      { to: "/system-health", label: "API & DB Health", section: "System", icon: Activity, keywords: "health status" },
    ];
  }
  return [
    { to: "/tenant", label: "Resident Portal", section: "Workspace", icon: User, end: true, keywords: "dashboard profile allocation documents" },
    { to: "/tenant/rent", label: "Rent & Receipts", section: "Billing", icon: Wallet, keywords: "invoices payment deposit receipts" },
    { to: "/tenant/complaints", label: "Complaints", section: "Services", icon: MessageSquareWarning, keywords: "support maintenance issue" },
    { to: "/tenant/food", label: "Food Menu & Skips", section: "Services", icon: UtensilsCrossed, keywords: "meals skip rating menu" },
    { to: "/system-health", label: "API & DB Health", section: "System", icon: Activity, keywords: "system health" },
  ];
}

function resolveRouteMeta(pathname: string, navItems: NavItem[]): { title: string; section: string } {
  const exact = navItems.find((item) => item.to === pathname);
  if (exact) return { title: exact.label, section: exact.section };
  if (pathname.startsWith("/rooms/")) return { title: "Room Details", section: "Operations" };
  if (pathname.startsWith("/tenants/") && pathname !== "/tenants/new") {
    return { title: "Tenant Profile & Ledger", section: "Operations" };
  }
  return { title: "Operations Workspace", section: "Workspace" };
}

function getInitials(name: string | undefined): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function AppLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("apg_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [loggingOut, setLoggingOut] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [quickSearch, setQuickSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const notifBoxRef = useRef<HTMLDivElement>(null);

  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, error } = useHealthStatus();

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("apg_sidebar_collapsed", String(next));
      } catch {
        // ignore storage restrictions
      }
      return next;
    });
  };

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
      if (notifBoxRef.current && !notifBoxRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const list = await fetchMyNotifications();
      setNotifications(list);
    } catch {
      // ignore transient poll failures
    }
  }, [user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleReadNotification(notifId: number) {
    try {
      await markNotificationRead(notifId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n))
      );
    } catch {
      // ignore
    }
  }

  async function handleReadAllNotifications() {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // ignore
    }
  }

  const navItems = useMemo(() => (user ? getNavItemsForRole(user.role) : []), [user]);
  const groupedSections = useMemo(() => {
    const groups: { section: string; items: NavItem[] }[] = [];
    for (const item of navItems) {
      const existing = groups.find((g) => g.section === item.section);
      if (existing) existing.items.push(item);
      else groups.push({ section: item.section, items: [item] });
    }
    return groups;
  }, [navItems]);

  const routeMeta = useMemo(
    () => resolveRouteMeta(location.pathname, navItems),
    [location.pathname, navItems]
  );

  const quickSearchMatches = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return navItems.slice(0, 5);
    return navItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.section.toLowerCase().includes(q) ||
        (item.keywords ?? "").toLowerCase().includes(q)
    );
  }, [quickSearch, navItems]);

  const docsUrl = `${import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"}/docs`;

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
    showToast("info", "Signed out", "Your session token has been revoked.");
    navigate("/login", { replace: true });
  }

  const renderNavLinks = (collapsed: boolean, onNavigate?: () => void) => (
    <nav
      className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4 scrollbar-thin"
      aria-label="Primary Navigation"
    >
      {groupedSections.map((group) => (
        <div key={group.section}>
          {!collapsed ? (
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400/80">
              {group.section}
            </p>
          ) : (
            <div className="mx-auto my-2 h-px w-6 bg-navy-800" />
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150",
                      collapsed ? "justify-center px-2" : "",
                      isActive
                        ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                        : "text-slate-300/85 hover:bg-white/[0.06] hover:text-white"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && !collapsed ? (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-emerald-400" />
                      ) : null}
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          isActive
                            ? "text-emerald-300"
                            : "text-slate-400 group-hover:text-slate-200"
                        )}
                      />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const renderUserFooter = (collapsed: boolean) =>
    user ? (
      <div className="border-t border-navy-800/90 p-3">
        {!collapsed ? (
          <div className="mb-2.5 rounded-xl bg-navy-800/75 p-2.5 ring-1 ring-white/5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600/25 text-xs font-semibold text-blue-200 ring-1 ring-brand-500/30">
                {getInitials(user.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">
                  {user.full_name}
                </p>
                <p className="truncate font-mono text-[10px] text-slate-400">
                  {user.mobile}
                </p>
              </div>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                {user.role}
              </span>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border border-navy-700/90 bg-navy-800/60 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-rose-500/70 hover:bg-rose-600 hover:text-white disabled:opacity-60",
            collapsed ? "px-2" : ""
          )}
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {!collapsed ? <span>{loggingOut ? "Signing out..." : "Sign out"}</span> : null}
        </button>
      </div>
    ) : null;

  return (
    <div className="flex min-h-screen bg-canvas text-slate-900">
      {/* Collapsible Desktop Sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-navy-800 bg-navy-900 text-white transition-[width] duration-200 ease-out lg:flex",
          sidebarCollapsed ? "w-[72px]" : "w-64"
        )}
      >
        <div
          className={cn(
            "flex items-center border-b border-navy-800/90 px-3.5 py-4",
            sidebarCollapsed ? "justify-center" : "justify-between gap-2"
          )}
        >
          <button
            type="button"
            onClick={() => navigate(user ? roleHomePath(user.role) : "/")}
            className="flex min-w-0 items-center gap-2.5 text-left"
          >
            <img src={brandMark} alt="Aapka PG" className="h-8 w-8 shrink-0" />
            {!sidebarCollapsed ? (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-white">
                  Aapka PG
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {user?.pg_name ?? "Operations Cloud"}
                </p>
              </div>
            ) : null}
          </button>

          {!sidebarCollapsed ? (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-navy-800 hover:text-white"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {sidebarCollapsed ? (
          <div className="flex justify-center border-b border-navy-800/70 py-2">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-navy-800 hover:text-white"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {renderNavLinks(sidebarCollapsed)}
        {renderUserFooter(sidebarCollapsed)}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-navy-950/60 backdrop-blur-[2px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="animate-drawer-in relative z-10 flex w-72 max-w-[85vw] flex-col bg-navy-900 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-navy-800 px-4 py-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <img src={brandMark} alt="Aapka PG" className="h-8 w-8 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">Aapka PG</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {user?.pg_name ?? "PG Platform"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-navy-800 hover:text-white"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderNavLinks(false, () => setMobileMenuOpen(false))}
            {renderUserFooter(false)}
          </aside>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 px-4 py-2.5 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            {/* Left: Mobile Trigger + Dynamic Breadcrumb & Title */}
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="min-w-0">
                <div className="hidden items-center gap-1 text-[11px] font-medium text-slate-400 sm:flex">
                  <span>{user?.pg_name ?? "Aapka PG"}</span>
                  <ChevronRight className="h-3 w-3" />
                  <span>{routeMeta.section}</span>
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-slate-600">{routeMeta.title}</span>
                </div>
                <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">
                  {routeMeta.title}
                </p>
              </div>
            </div>

            {/* Right: Quick Search + Status + Notifications + Profile Menu */}
            <div className="flex items-center gap-2 sm:gap-2.5">
              {/* Quick Navigation Jump */}
              <div ref={searchBoxRef} className="relative hidden md:block">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={quickSearch}
                    onFocus={() => setSearchFocused(true)}
                    onChange={(e) => {
                      setQuickSearch(e.target.value);
                      setSearchFocused(true);
                    }}
                    placeholder="Jump to module..."
                    aria-label="Jump to module"
                    className="h-8 w-44 rounded-lg border border-slate-200 bg-slate-50/70 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 transition-all focus:w-56 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                  />
                </div>
                {searchFocused && quickSearchMatches.length > 0 ? (
                  <div className="animate-dropdown-in absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-popover">
                    <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Quick Navigation
                    </p>
                    {quickSearchMatches.slice(0, 6).map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.to}
                          type="button"
                          onClick={() => {
                            navigate(item.to);
                            setQuickSearch("");
                            setSearchFocused(false);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Icon className="h-3.5 w-3.5 text-slate-400" />
                          <span className="flex-1 truncate">{item.label}</span>
                          <span className="text-[10px] text-slate-400">{item.section}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Compact API Health Pill */}
              <button
                type="button"
                onClick={() => navigate("/system-health")}
                title={
                  error
                    ? "API Offline"
                    : `API Online · Database ${data?.database ?? "connected"}`
                }
                className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-100 sm:inline-flex"
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    loading
                      ? "bg-blue-500 animate-pulse"
                      : error
                        ? "bg-rose-500"
                        : "bg-emerald-500"
                  )}
                />
                <span>{loading ? "Checking" : error ? "Offline" : "API Live"}</span>
              </button>

              {/* Notifications Dropdown */}
              <div ref={notifBoxRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    const next = !notifOpen;
                    setNotifOpen(next);
                    if (next) void loadNotifications();
                  }}
                  className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50"
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </button>

                {notifOpen ? (
                  <div className="animate-dropdown-in absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200/90 bg-white p-3 shadow-popover">
                    <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-xs font-semibold text-slate-900">
                        Notifications ({unreadCount} unread)
                      </span>
                      {unreadCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => void handleReadAllNotifications()}
                          className="text-[11px] font-medium text-brand-700 hover:underline"
                        >
                          Mark all read
                        </button>
                      ) : null}
                    </div>
                    {notifications.length === 0 ? (
                      <p className="py-5 text-center text-xs text-slate-500">
                        You are all caught up.
                      </p>
                    ) : (
                      <div className="max-h-72 space-y-1.5 overflow-y-auto scrollbar-thin">
                        {notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => void handleReadNotification(n.id)}
                            className={cn(
                              "w-full rounded-lg border p-2.5 text-left text-xs transition-colors",
                              n.is_read
                                ? "border-slate-100 bg-slate-50/70 text-slate-600"
                                : "border-brand-200/80 bg-brand-50/50 text-slate-900"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold">{n.title}</p>
                              {!n.is_read ? (
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                              {n.message}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-400">
                              {formatDateTime(n.created_at)}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* User Profile Dropdown */}
              {user ? (
                <DropdownMenu
                  align="right"
                  trigger={() => (
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-1.5 pr-2 text-left transition-colors hover:bg-slate-50"
                      aria-label="User profile menu"
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-navy-900 text-[11px] font-semibold text-white">
                        {getInitials(user.full_name)}
                      </div>
                      <div className="hidden text-left sm:block">
                        <p className="max-w-[110px] truncate text-xs font-semibold leading-none text-slate-800">
                          {user.full_name}
                        </p>
                        <p className="mt-0.5 text-[10px] capitalize leading-none text-slate-500">
                          {user.role}
                        </p>
                      </div>
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="space-y-1">
                      <div className="border-b border-slate-100 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-slate-900">
                            {user.full_name}
                          </p>
                          <Badge tone="info" className="uppercase">
                            {user.role}
                          </Badge>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {user.mobile}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          navigate(roleHomePath(user.role));
                          close();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <LayoutDashboard className="h-3.5 w-3.5 text-slate-400" />
                        <span>Dashboard Home</span>
                      </button>

                      {user.role === "owner" ? (
                        <button
                          type="button"
                          onClick={() => {
                            navigate("/owner/settings");
                            close();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Settings className="h-3.5 w-3.5 text-slate-400" />
                          <span>PG Property Settings</span>
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => {
                          navigate("/system-health");
                          close();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Activity className="h-3.5 w-3.5 text-slate-400" />
                        <span>API &amp; DB Health</span>
                      </button>

                      <a
                        href={docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={close}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                        <span>OpenAPI Documentation</span>
                      </a>

                      <div className="border-t border-slate-100 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            void handleLogout();
                          }}
                          disabled={loggingOut}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>{loggingOut ? "Signing out..." : "Sign out"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </DropdownMenu>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div key={location.pathname} className="animate-fade-in-up">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
