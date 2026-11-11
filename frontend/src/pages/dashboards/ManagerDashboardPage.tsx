import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BedDouble,
  Clock,
  DoorOpen,
  MessageSquareWarning,
  RefreshCw,
  UserPlus,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/shared/StateHelpers";
import {
  ComplaintCategoryBadge,
  ComplaintStatusBadge,
  TenantStatusBadge,
} from "@/components/shared/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatDateTime } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import { fetchManagerComplaints } from "@/services/complaintService";
import { fetchManagerFoodOverview } from "@/services/foodService";
import { listRooms } from "@/services/roomService";
import { listTenants } from "@/services/tenantMgmtService";
import {
  DayOfWeek,
  ManagerComplaintSummary,
  ManagerFoodOverview,
  MealType,
  RoomDetail,
  TenantSummary,
} from "@/types/api";

const WEEKDAYS: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MEALS: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

export function ManagerDashboardPage() {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [rooms, setRooms] = useState<RoomDetail[]>([]);
  const [complaints, setComplaints] = useState<ManagerComplaintSummary | null>(null);
  const [food, setFood] = useState<ManagerFoodOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantRows, roomRows, complaintSummary, foodOverview] = await Promise.all([
        listTenants(),
        listRooms(),
        fetchManagerComplaints(),
        fetchManagerFoodOverview(),
      ]);
      setTenants(tenantRows);
      setRooms(roomRows);
      setComplaints(complaintSummary);
      setFood(foodOverview);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  if (loading && rooms.length === 0 && !complaints) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
        title="Unable to load Manager Workspace"
        description={error}
        action={<Button onClick={loadWorkspace}>Retry</Button>}
      />
    );
  }

  const activeTenants = tenants.filter(
    (t) => t.status === "active" || t.status === "notice_period"
  );
  const noticeTenantsCount = tenants.filter((t) => t.status === "notice_period").length;
  const totalBeds = rooms.reduce((acc, r) => acc + r.total_beds, 0);
  const vacantBeds = rooms.reduce((acc, r) => acc + r.vacant_beds, 0);
  const maintenanceBeds = rooms.reduce((acc, r) => acc + r.maintenance_beds, 0);
  const pendingComplaintsCount =
    (complaints?.new_count ?? 0) +
    (complaints?.viewed_count ?? 0) +
    (complaints?.in_progress_count ?? 0);

  const todayKey = WEEKDAYS[new Date().getDay()];
  const todayMenuSlots = (food?.weekly_menu ?? []).filter(
    (slot) => slot.day_of_week === todayKey
  );
  const recentTenants = [...tenants]
    .sort((a, b) => new Date(b.joining_date).getTime() - new Date(a.joining_date).getTime() || b.id - a.id)
    .slice(0, 5);
  const openComplaints = (complaints?.complaints ?? [])
    .filter((c) => c.status !== "resolved")
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: user?.pg_name ?? "Property" }, { label: "Manager Workspace" }]}
        title={`Welcome back, ${user?.full_name ?? "Manager"}`}
        subtitle="Daily occupancy status, open maintenance requests, resident onboarding activity, and today's meal schedule."
        badge={<Badge tone="info">Manager Operations</Badge>}
        actions={
          <>
            <Link to="/tenants/new">
              <Button variant="primary" size="sm">
                <UserPlus className="h-4 w-4" />
                <span>Register Tenant</span>
              </Button>
            </Link>
            <Link to="/vacancies">
              <Button variant="outline" size="sm">
                <BedDouble className="h-4 w-4" />
                <span>Vacancy Board</span>
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={loadWorkspace}
              aria-label="Refresh manager workspace"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      {/* Core Operational KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Tenants"
          value={activeTenants.length}
          sublabel={
            noticeTenantsCount > 0
              ? `${noticeTenantsCount} on notice period`
              : "All active residents"
          }
          icon={Users}
          tone="navy"
        />
        <StatCard
          label="Vacant Beds"
          value={vacantBeds}
          sublabel={`${totalBeds} total · ${maintenanceBeds} maintenance`}
          badge={
            <Badge tone={vacantBeds > 0 ? "success" : "neutral"}>
              {rooms.length} Rooms
            </Badge>
          }
          icon={BedDouble}
          tone="emerald"
        />
        <StatCard
          label="Pending Complaints"
          value={pendingComplaintsCount}
          sublabel={`${complaints?.new_count ?? 0} new · ${complaints?.in_progress_count ?? 0} in progress`}
          badge={
            pendingComplaintsCount > 0 ? (
              <Badge tone="warning">Needs Attention</Badge>
            ) : (
              <Badge tone="success">All Clear</Badge>
            )
          }
          icon={MessageSquareWarning}
          tone={pendingComplaintsCount > 0 ? "amber" : "emerald"}
        />
        <StatCard
          label="Today's Meal Skips"
          value={
            (food?.skip_counts.breakfast ?? 0) +
            (food?.skip_counts.lunch ?? 0) +
            (food?.skip_counts.dinner ?? 0)
          }
          sublabel={`B: ${food?.skip_counts.breakfast ?? 0} · L: ${food?.skip_counts.lunch ?? 0} · D: ${food?.skip_counts.dinner ?? 0}`}
          badge={
            <Badge tone={food?.is_menu_published ? "success" : "warning"}>
              {food?.is_menu_published ? "Published" : "Draft"}
            </Badge>
          }
          icon={UtensilsCrossed}
          tone="blue"
        />
      </div>

      {/* Today's Meals + Room Availability */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Today's Meal Information */}
        <Card>
          <CardHeader
            title={`Today's Meal Schedule (${todayKey.charAt(0).toUpperCase() + todayKey.slice(1)})`}
            subtitle="Live kitchen menu slots and resident skip counts for today"
            action={
              <Link
                to="/food-management"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>Food &amp; Menu</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {MEALS.map((meal) => {
              const slot = todayMenuSlots.find((s) => s.meal_type === meal.key);
              const skipCount = food?.skip_counts[meal.key] ?? 0;
              return (
                <div
                  key={meal.key}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                        {meal.label}
                      </span>
                      {slot?.timing_label ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <Clock className="h-3 w-3" />
                          {slot.timing_label}
                        </span>
                      ) : null}
                    </div>
                    <Badge tone={skipCount > 0 ? "warning" : "neutral"}>
                      {skipCount} skip{skipCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-slate-900">
                    {slot?.meal_name || slot?.items_description || "Not configured yet"}
                  </p>
                  {slot?.meal_name && slot.items_description ? (
                    <p className="mt-0.5 text-xs text-slate-500">{slot.items_description}</p>
                  ) : null}
                </div>
              );
            })}
          </CardBody>
        </Card>

        {/* Room Availability Overview */}
        <Card>
          <CardHeader
            title="Room Availability"
            subtitle="Per-room capacity and real-time vacant beds"
            action={
              <Link
                to="/rooms"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>All Rooms</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody>
            {rooms.length === 0 ? (
              <EmptyState
                icon={<DoorOpen className="h-5 w-5" />}
                title="No rooms configured"
                description="Create rooms and beds to manage allocations."
              />
            ) : (
              <div className="space-y-3">
                {rooms.slice(0, 6).map((room) => {
                  const occPct =
                    room.total_beds > 0
                      ? Math.round((room.occupied_beds / room.total_beds) * 100)
                      : 0;
                  return (
                    <Link
                      key={room.id}
                      to={`/rooms/${room.id}`}
                      className="block rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-semibold text-slate-900">
                            Room {room.room_number}
                          </span>
                          <span className="ml-2 text-xs capitalize text-slate-500">
                            {room.floor} · {room.sharing_type}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={room.vacant_beds > 0 ? "success" : "neutral"}>
                            {room.vacant_beds} vacant
                          </Badge>
                          <span className="text-xs font-medium tabular-nums text-slate-500">
                            {room.occupied_beds}/{room.total_beds}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-navy-900"
                          style={{ width: `${occPct}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Complaint Overview & Recent Tenant Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Complaint Management Overview"
            subtitle="Open maintenance & service tickets awaiting resolution"
            action={
              <Link
                to="/complaints"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>Open Tickets</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody>
            {openComplaints.length === 0 ? (
              <EmptyState
                icon={<MessageSquareWarning className="h-5 w-5" />}
                title="No open complaints"
                description="All reported resident tickets have been resolved."
              />
            ) : (
              <div className="space-y-2.5">
                {openComplaints.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ComplaintCategoryBadge category={c.category} />
                        <span className="truncate font-semibold text-slate-900">
                          {c.title}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {c.tenant_name} · Room {c.room_number} ({c.bed_code}) ·{" "}
                        {formatDateTime(c.submitted_at)}
                      </p>
                    </div>
                    <ComplaintStatusBadge status={c.status} />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent Tenant Activity"
            subtitle="Latest onboarding, notice-period, and resident updates"
            action={
              <Link
                to="/tenants"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>Directory</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody>
            {recentTenants.length === 0 ? (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No tenants registered"
                description="Register a resident to allocate a bed and start billing."
              />
            ) : (
              <div className="space-y-2.5">
                {recentTenants.map((t) => (
                  <Link
                    key={t.id}
                    to={`/tenants/${t.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-xs transition-colors hover:border-slate-200 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{t.full_name}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Room {t.room_number} · {t.bed_code} · Joined{" "}
                        {formatDate(t.joining_date)}
                      </p>
                    </div>
                    <TenantStatusBadge status={t.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
