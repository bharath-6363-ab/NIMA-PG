import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BedDouble,
  Bell,
  CalendarOff,
  Download,
  FileText,
  History,
  Home,
  IndianRupee,
  MessageSquareWarning,
  RefreshCw,
  ShieldCheck,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { AuthImage, downloadProtectedFile } from "@/components/shared/AuthImage";
import { EmptyState } from "@/components/shared/StateHelpers";
import {
  ComplaintCategoryBadge,
  ComplaintStatusBadge,
  DepositStatusBadge,
  PaymentStatusBadge,
  RentStatusBadge,
  TenantStatusBadge,
} from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatDateTime, formatINR, monthName } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  fetchMyNotifications,
  fetchTenantComplaintSummary,
  markNotificationRead,
} from "@/services/complaintService";
import {
  cancelMealSkip,
  fetchTenantFoodOverview,
  submitMealSkip,
} from "@/services/foodService";
import { getMyTenantProfile } from "@/services/tenantMgmtService";
import { fetchTenantRentSummary } from "@/services/tenantService";
import {
  DayOfWeek,
  MealType,
  NotificationItem,
  TenantComplaintSummary,
  TenantFoodOverview,
  TenantRentSummary,
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

function getTomorrowISO(): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export function MyProfilePage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [profile, setProfile] = useState<TenantSummary | null>(null);
  const [rentSummary, setRentSummary] = useState<TenantRentSummary | null>(null);
  const [complaints, setComplaints] = useState<TenantComplaintSummary | null>(null);
  const [food, setFood] = useState<TenantFoodOverview | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick meal skip widget state
  const [skipDate, setSkipDate] = useState<string>(getTomorrowISO());
  const [skipMeal, setSkipMeal] = useState<MealType>("lunch");
  const [skipReason, setSkipReason] = useState("");
  const [submittingSkip, setSubmittingSkip] = useState(false);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profRes, notifRes] = await Promise.allSettled([
        getMyTenantProfile(),
        fetchMyNotifications(),
      ]);

      if (notifRes.status === "fulfilled") {
        setNotifications(notifRes.value);
      }

      if (profRes.status === "rejected") {
        setProfile(null);
        setError(extractApiError(profRes.reason));
        return;
      }

      setProfile(profRes.value);

      const [rentRes, compRes, foodRes] = await Promise.allSettled([
        fetchTenantRentSummary(),
        fetchTenantComplaintSummary(),
        fetchTenantFoodOverview(),
      ]);

      if (rentRes.status === "fulfilled") setRentSummary(rentRes.value);
      if (compRes.status === "fulfilled") setComplaints(compRes.value);
      if (foodRes.status === "fulfilled") setFood(foodRes.value);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  async function handleQuickSkip(e: FormEvent) {
    e.preventDefault();
    setSubmittingSkip(true);
    try {
      await submitMealSkip({
        skip_date: skipDate,
        meal_type: skipMeal,
        reason: skipReason.trim() || undefined,
      });
      showToast("success", "Meal skip recorded", `${skipMeal} on ${formatDate(skipDate)}`);
      setSkipReason("");
      const updated = await fetchTenantFoodOverview();
      setFood(updated);
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSubmittingSkip(false);
    }
  }

  async function handleCancelQuickSkip(skipId: number) {
    try {
      await cancelMealSkip(skipId);
      showToast("info", "Meal skip cancelled");
      const updated = await fetchTenantFoodOverview();
      setFood(updated);
    } catch (err) {
      showToast("error", extractApiError(err));
    }
  }

  async function handleReadNotif(id: number) {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      // ignore
    }
  }

  if (loading && !profile) {
    return <DashboardSkeleton />;
  }

  if (error || !profile) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[{ label: user?.pg_name ?? "Resident Portal" }, { label: "Account" }]}
          title={`Welcome, ${user?.full_name ?? "Resident"}`}
          subtitle="Your mobile-verified tenant account is active. Room and bed allocation is pending."
          badge={<Badge tone="success" dot>Verified Account</Badge>}
          actions={
            <Button variant="outline" size="sm" onClick={loadPortal}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Check Allocation</span>
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardBody className="py-10">
              <EmptyState
                icon={<Home className="h-6 w-6" />}
                title="Room & bed not assigned yet"
                description="Your tenant login is verified and active. Ask your PG Manager or Owner to allocate a room and bed using your registered mobile number to unlock rent ledgers, complaints, and meal preferences."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Account Details" subtitle="Registered identity & PG link" />
            <CardBody className="space-y-3 text-xs">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Full Name</span>
                <span className="font-semibold text-slate-900">{user?.full_name ?? "—"}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Mobile</span>
                <span className="font-mono text-slate-800">{user?.mobile ?? "—"}</span>
              </div>
              {user?.email ? (
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Email</span>
                  <span className="text-slate-800">{user.email}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-slate-500">PG Property</span>
                <span className="font-medium text-slate-900">{user?.pg_name ?? "Assigned on onboarding"}</span>
              </div>
            </CardBody>
          </Card>
        </div>

        {notifications.length > 0 ? (
          <Card>
            <CardHeader title="Notifications" subtitle="Account verification & onboarding updates" />
            <CardBody className="space-y-2.5">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-xs"
                >
                  <p className="font-semibold text-slate-900">{n.title}</p>
                  <p className="mt-0.5 text-slate-600">{n.message}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}
      </div>
    );
  }

  const currentRent = rentSummary?.current_rent ?? null;
  const openComplaintsCount =
    (complaints?.open_count ?? 0) + (complaints?.in_progress_count ?? 0);
  const todayKey = WEEKDAYS[new Date().getDay()];
  const todayMeals = (food?.weekly_menu ?? []).filter(
    (m) => m.day_of_week === todayKey
  );
  const activeSkips = (food?.my_skips ?? []).filter((s) => s.status === "active");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: rentSummary?.pg_name ?? "Resident Portal" },
          { label: "Dashboard" },
        ]}
        title={`Welcome, ${profile.full_name}`}
        subtitle={`Room ${profile.room_number} · Bed ${profile.bed_code} · Resident since ${formatDate(
          profile.joining_date
        )}`}
        badge={<TenantStatusBadge status={profile.status} />}
        actions={
          <>
            <Link to="/tenant/rent">
              <Button variant="primary" size="sm">
                <Wallet className="h-4 w-4" />
                <span>Rent &amp; Receipts</span>
              </Button>
            </Link>
            <Link to="/tenant/complaints">
              <Button variant="outline" size="sm">
                <MessageSquareWarning className="h-4 w-4" />
                <span>Complaints</span>
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={loadPortal}
              aria-label="Refresh resident portal"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      {/* Resident KPI Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Monthly Room + Food"
          value={formatINR(
            parseFloat(profile.monthly_rent) + parseFloat(profile.food_charges)
          )}
          sublabel={`Room ${formatINR(profile.monthly_rent)} · Food ${formatINR(
            profile.food_charges
          )}`}
          icon={BedDouble}
          tone="navy"
        />
        <StatCard
          label="Current Rent Balance"
          value={currentRent ? formatINR(currentRent.balance_due) : "₹0"}
          sublabel={
            currentRent
              ? `${monthName(currentRent.billing_month)} ${currentRent.billing_year} · Due ${formatDate(
                  currentRent.due_date
                )}`
              : "No bill generated yet"
          }
          badge={
            currentRent ? (
              <RentStatusBadge status={currentRent.status} />
            ) : (
              <Badge tone="neutral">Settled</Badge>
            )
          }
          icon={IndianRupee}
          tone={
            currentRent && parseFloat(currentRent.balance_due) > 0 ? "amber" : "emerald"
          }
        />
        <StatCard
          label="Security Deposit Held"
          value={formatINR(
            rentSummary?.security_deposit.amount_held ?? profile.security_deposit_amount
          )}
          sublabel="Refundable on checkout"
          badge={
            rentSummary?.security_deposit.paid_status ? (
              <DepositStatusBadge status={rentSummary.security_deposit.paid_status} />
            ) : profile.deposit_status ? (
              <DepositStatusBadge status={profile.deposit_status} />
            ) : null
          }
          icon={ShieldCheck}
          tone="blue"
        />
        <StatCard
          label="Open Complaints"
          value={openComplaintsCount}
          sublabel={`${complaints?.resolved_count ?? 0} resolved tickets`}
          icon={MessageSquareWarning}
          tone={openComplaintsCount > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* Rent Status + Today's Food Menu & Quick Skip */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Monthly Rent & Payment History */}
        <Card>
          <CardHeader
            title="Monthly Rent & Payment History"
            subtitle="Live billing breakdown and recent verified payments"
            action={
              <Link
                to="/tenant/rent"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>Pay / Download Receipts</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody className="space-y-4">
            {currentRent ? (
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      {monthName(currentRent.billing_month)} {currentRent.billing_year} Bill
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
                      {formatINR(currentRent.total_amount)}
                    </p>
                  </div>
                  <RentStatusBadge status={currentRent.status} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200/70 pt-3 text-xs">
                  <div>
                    <p className="text-slate-500">Paid</p>
                    <p className="font-semibold tabular-nums text-emerald-700">
                      {formatINR(currentRent.amount_paid)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Balance</p>
                    <p className="font-semibold tabular-nums text-slate-900">
                      {formatINR(currentRent.balance_due)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Due Date</p>
                    <p className="font-semibold text-slate-700">
                      {formatDate(currentRent.due_date)}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No active invoice generated for the current cycle yet.
              </p>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recent Payments
              </p>
              {!rentSummary?.payment_history || rentSummary.payment_history.length === 0 ? (
                <p className="text-xs text-slate-500">No payments recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {rentSummary.payment_history.slice(0, 4).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">{p.receipt_number}</p>
                        <p className="text-[11px] uppercase text-slate-500">
                          {p.payment_method.replace("_", " ")} ·{" "}
                          {formatDate(p.paid_at ?? p.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <PaymentStatusBadge status={p.status} />
                        <span className="font-semibold tabular-nums text-slate-900">
                          {formatINR(p.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Weekly Food Menu (Today) + Quick Meal Skip */}
        <Card>
          <CardHeader
            title={`Today's Meals (${todayKey.charAt(0).toUpperCase() + todayKey.slice(1)})`}
            subtitle="Published weekly menu and quick meal skip request"
            action={
              <Link
                to="/tenant/food"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>Full Weekly Menu</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody className="space-y-4">
            {todayMeals.length === 0 ? (
              <EmptyState
                icon={<UtensilsCrossed className="h-5 w-5" />}
                title="Weekly menu not published"
                description="Your PG manager has not published today's meal slots yet."
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {todayMeals.map((slot) => (
                  <div
                    key={slot.id}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-xs"
                  >
                    <p className="font-semibold uppercase tracking-wide text-brand-700">
                      {slot.meal_type}
                    </p>
                    <p className="mt-1 font-medium text-slate-900">
                      {slot.meal_name || slot.items_description}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">{slot.timing_label}</p>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={handleQuickSkip}
              className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <CalendarOff className="h-3.5 w-3.5 text-brand-600" />
                <span>Quick Skip Request (respects kitchen cutoff)</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <FieldLabel htmlFor="portal-skip-date" label="Date" />
                  <Input
                    id="portal-skip-date"
                    type="date"
                    value={skipDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setSkipDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="portal-skip-meal" label="Meal" />
                  <Select
                    id="portal-skip-meal"
                    value={skipMeal}
                    onChange={(e) => setSkipMeal(e.target.value as MealType)}
                  >
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor="portal-skip-reason" label="Reason (Optional)" />
                  <Input
                    id="portal-skip-reason"
                    placeholder="Out for work"
                    value={skipReason}
                    onChange={(e) => setSkipReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  {activeSkips.length} upcoming active skip{activeSkips.length === 1 ? "" : "s"}
                </span>
                <Button type="submit" size="sm" loading={submittingSkip}>
                  Submit Meal Skip
                </Button>
              </div>
            </form>

            {activeSkips.length > 0 ? (
              <div className="space-y-1.5">
                {activeSkips.slice(0, 2).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-1.5 text-xs"
                  >
                    <span className="text-slate-700">
                      <strong className="capitalize">{s.meal_type}</strong> on{" "}
                      {formatDate(s.skip_date)}
                    </span>
                    {s.can_cancel ? (
                      <button
                        type="button"
                        onClick={() => void handleCancelQuickSkip(s.id)}
                        className="text-[11px] font-medium text-rose-600 hover:underline"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* Complaints & Notifications */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="My Maintenance Complaints"
            subtitle="Track open issues and resolution updates"
            action={
              <Link
                to="/tenant/complaints"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>Submit / Manage</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody>
            {!complaints || complaints.complaints.length === 0 ? (
              <EmptyState
                icon={<MessageSquareWarning className="h-5 w-5" />}
                title="No complaints submitted"
                description="Need plumbing, electrical, WiFi or cleaning help? Submit a request anytime."
              />
            ) : (
              <div className="space-y-2.5">
                {complaints.complaints.slice(0, 4).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ComplaintCategoryBadge category={c.category} />
                        <span className="truncate font-semibold text-slate-900">
                          {c.title}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Submitted {formatDateTime(c.submitted_at)}
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
            title="Recent Notifications"
            subtitle="Rent reminders, payment receipts & complaint alerts"
            action={<Bell className="h-4 w-4 text-slate-400" />}
          />
          <CardBody>
            {notifications.length === 0 ? (
              <EmptyState
                icon={<Bell className="h-5 w-5" />}
                title="No notifications yet"
                description="Reminders and status updates from PG management appear here."
              />
            ) : (
              <div className="space-y-2">
                {notifications.slice(0, 5).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void handleReadNotif(n.id)}
                    className={`w-full rounded-xl border p-3 text-left text-xs transition-colors ${
                      n.is_read
                        ? "border-slate-100 bg-slate-50/50 text-slate-600"
                        : "border-brand-200 bg-brand-50/40 text-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{n.title}</span>
                      <span className="text-[10px] text-slate-400">
                        {formatDateTime(n.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{n.message}</p>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Personal Profile, Security Deposit & KYC Documents + Allocation History */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Resident Details"
            subtitle="Private to your verified account"
          />
          <CardBody>
            <dl className="grid grid-cols-1 gap-2.5 text-xs">
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-slate-500">Mobile Number</dt>
                <dd className="mt-0.5 font-mono font-semibold text-slate-900">
                  {profile.mobile}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-slate-500">Email</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{profile.email ?? "—"}</dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-slate-500">Emergency Contact</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {profile.emergency_contact_name} ({profile.emergency_contact_phone})
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-slate-500">Police Verification</dt>
                <dd className="mt-1">
                  <Badge tone="info" className="capitalize">
                    {profile.police_verification_status.replace("_", " ")}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Submitted Documents" />
          <CardBody>
            {profile.documents.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No documents uploaded"
                description="Documents uploaded by your PG Manager during onboarding appear here."
              />
            ) : (
              <div className="space-y-2.5">
                {profile.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {doc.mime_type.startsWith("image/") ? (
                        <AuthImage
                          src={doc.url}
                          alt={doc.file_name}
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <FileText className="h-5 w-5 text-brand-600" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {doc.file_name}
                        </p>
                        <p className="text-[11px] capitalize text-slate-500">
                          {doc.doc_type.replace("_", " ")}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void downloadProtectedFile(doc.url, doc.file_name)}
                      aria-label={`Download ${doc.file_name}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Allocation History"
            action={<History className="h-4 w-4 text-slate-400" />}
          />
          <CardBody>
            {profile.allocation_history.length === 0 ? (
              <EmptyState
                icon={<History className="h-5 w-5" />}
                title="No allocation history"
                description="Your room & bed assignment log will appear here."
              />
            ) : (
              <div className="space-y-2.5">
                {profile.allocation_history.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold uppercase text-brand-700">
                        {h.action.replace("_", " ")}
                      </span>
                      <span className="text-slate-500">{formatDate(h.start_date)}</span>
                    </div>
                    <p className="mt-1 font-medium text-slate-900">
                      Room {h.room_number} · Bed {h.bed_code}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
