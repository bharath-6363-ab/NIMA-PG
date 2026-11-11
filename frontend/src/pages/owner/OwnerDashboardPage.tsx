import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  ArrowRight,
  BedDouble,
  BellRing,
  Building2,
  Calendar,
  ExternalLink,
  IndianRupee,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ChartContainer } from "@/components/ui/ChartContainer";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input, SearchInput, Select } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/shared/StateHelpers";
import {
  ComplaintStatusBadge,
  PaymentStatusBadge,
  RentStatusBadge,
  TenantStatusBadge,
} from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatDateTime, formatINR, monthName } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  fetchOwnerDashboard,
  sendOwnerRentReminder,
} from "@/services/ownerService";
import { OwnerFinanceDashboard, OwnerPendingRentRow } from "@/types/api";

const PIE_COLORS = ["#0F1E36", "#10B981", "#F59E0B", "#E11D48"];

export function OwnerDashboardPage() {
  const { showToast } = useToast();
  const today = new Date();
  const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [selectedPgId, setSelectedPgId] = useState<number | undefined>(undefined);
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [startDate, setStartDate] = useState<string>(
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState<string>(today.toISOString().slice(0, 10));
  const [searchQuery, setSearchQuery] = useState("");

  const [data, setData] = useState<OwnerFinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<number | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOwnerDashboard({
        month,
        year,
        pg_id: selectedPgId,
        start_date: useCustomRange ? startDate : undefined,
        end_date: useCustomRange ? endDate : undefined,
        search: searchQuery.trim() || undefined,
      });
      setData(res);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [month, year, selectedPgId, useCustomRange, startDate, endDate, searchQuery]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  function applyPreset(preset: "current" | "previous") {
    setUseCustomRange(false);
    if (preset === "current") {
      setMonth(today.getMonth() + 1);
      setYear(today.getFullYear());
    } else {
      setMonth(prevMonthDate.getMonth() + 1);
      setYear(prevMonthDate.getFullYear());
    }
  }

  async function handleSendReminder(rentRecordId: number) {
    setRemindingId(rentRecordId);
    try {
      const res = await sendOwnerRentReminder(rentRecordId);
      showToast("success", "Reminder sent", "In-app notification delivered to resident.");
      await loadDashboard();
      if (res.whatsapp_url) {
        window.open(res.whatsapp_url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setRemindingId(null);
    }
  }

  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
        title="Unable to load Owner Dashboard"
        description={error ?? "Please verify your owner account and try again."}
        action={<Button onClick={loadDashboard}>Retry</Button>}
      />
    );
  }

  const occupancyPieData = [
    {
      name: "Occupied",
      value: Math.max(0, data.occupied_beds - (data.notice_period_beds ?? 0)),
    },
    { name: "Vacant", value: data.vacant_beds ?? 0 },
    { name: "Notice Period", value: data.notice_period_beds ?? 0 },
    { name: "Maintenance", value: data.maintenance_beds ?? 0 },
  ].filter((d) => d.value > 0);

  const trendChartData = data.monthly_trend.map((pt) => ({
    label: pt.label,
    Expected: parseFloat(pt.expected),
    Collected: parseFloat(pt.collected),
  }));

  const expectedNum = parseFloat(data.total_expected_rent) || 0;
  const collectedNum = parseFloat(data.total_collected_rent) || 0;
  const collectionPct =
    expectedNum > 0 ? Math.min(100, Math.round((collectedNum / expectedNum) * 100)) : 0;

  const pendingColumns: ColumnDef<OwnerPendingRentRow>[] = [
    {
      key: "tenant",
      header: "Resident",
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-900">{row.tenant_name}</p>
          <p className="font-mono text-[11px] text-slate-500">{row.tenant_mobile}</p>
        </div>
      ),
    },
    {
      key: "room",
      header: "Allocation",
      render: (row) => (
        <span className="text-xs font-medium text-slate-700">
          Room {row.room_number} · {row.bed_code}
        </span>
      ),
    },
    {
      key: "due",
      header: "Due Date",
      render: (row) => (
        <div className="text-xs text-slate-600">
          <span>{formatDate(row.due_date)}</span>
          {row.days_overdue > 0 ? (
            <span className="ml-1.5 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
              {row.days_overdue}d late
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "balance",
      header: "Balance Due",
      align: "right",
      render: (row) => (
        <span className="font-semibold text-slate-900">
          {formatINR(row.balance_due)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <RentStatusBadge status={row.status} />,
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          loading={remindingId === row.rent_record_id}
          onClick={() => void handleSendReminder(row.rent_record_id)}
        >
          <BellRing className="h-3.5 w-3.5" />
          <span>Remind</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: data.pg_name || "Portfolio" }, { label: "Owner Overview" }]}
        title="Executive Portfolio Dashboard"
        subtitle={`Live revenue collections, occupancy rates, and operations for ${
          useCustomRange ? "selected custom range" : `${monthName(data.month)} ${data.year}`
        }.`}
        badge={
          <Badge tone="info">
            {data.total_properties ?? 1}{" "}
            {(data.total_properties ?? 1) === 1 ? "Property" : "Properties"}
          </Badge>
        }
        actions={
          <>
            <Link to="/owner/reports">
              <Button variant="outline" size="sm">
                <TrendingUp className="h-4 w-4" />
                <span>Financial Reports</span>
              </Button>
            </Link>
            <Link to="/vacancies">
              <Button variant="primary" size="sm">
                <BedDouble className="h-4 w-4" />
                <span>Vacancy Board</span>
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={loadDashboard}
              aria-label="Refresh dashboard"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      {/* Filter Bar */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100/80 p-1">
              <button
                type="button"
                onClick={() => applyPreset("current")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  !useCustomRange &&
                  month === today.getMonth() + 1 &&
                  year === today.getFullYear()
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Current Month
              </button>
              <button
                type="button"
                onClick={() => applyPreset("previous")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  !useCustomRange &&
                  month === prevMonthDate.getMonth() + 1 &&
                  year === prevMonthDate.getFullYear()
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Previous Month
              </button>
              <button
                type="button"
                onClick={() => setUseCustomRange((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  useCustomRange
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Custom Range</span>
              </button>
            </div>

            {data.properties && data.properties.length > 1 ? (
              <div className="w-full sm:w-64">
                <Select
                  aria-label="Select PG property"
                  value={String(selectedPgId ?? data.pg_id ?? "")}
                  onChange={(e) => setSelectedPgId(Number(e.target.value))}
                >
                  {data.properties.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({p.city})
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {useCustomRange ? (
              <>
                <div>
                  <FieldLabel htmlFor="dash-start" label="Start Date" />
                  <Input
                    id="dash-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="dash-end" label="End Date" />
                  <Input
                    id="dash-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <FieldLabel htmlFor="dash-month" label="Billing Month" />
                  <Select
                    id="dash-month"
                    value={String(month)}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                      <option key={m} value={String(m)}>
                        {monthName(m)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor="dash-year" label="Billing Year" />
                  <Select
                    id="dash-year"
                    value={String(year)}
                    onChange={(e) => setYear(Number(e.target.value))}
                  >
                    {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(
                      (y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      )
                    )}
                  </Select>
                </div>
              </>
            )}

            <div className="lg:col-span-2">
              <FieldLabel htmlFor="dash-search" label="Filter Pending Accounts" />
              <SearchInput
                id="dash-search"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search pending tenant or room..."
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Primary Financial KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total Monthly Rent"
          value={formatINR(data.total_expected_rent)}
          sublabel={
            useCustomRange ? "Custom date range" : `${monthName(data.month)} ${data.year}`
          }
          icon={IndianRupee}
          tone="navy"
        />
        <StatCard
          label="Rent Collected"
          value={formatINR(data.total_collected_rent)}
          sublabel={`${collectionPct}% of expected billed`}
          badge={<Badge tone="success">{data.paid_tenants_count} Paid</Badge>}
          icon={TrendingUp}
          tone="emerald"
        />
        <StatCard
          label="Pending Rent"
          value={formatINR(data.total_pending_rent)}
          sublabel="Within billing due window"
          badge={<Badge tone="warning">{data.pending_tenants_count} Open</Badge>}
          icon={Wallet}
          tone="amber"
        />
        <StatCard
          label="Overdue Rent"
          value={formatINR(data.total_overdue_rent)}
          sublabel="Past scheduled due date"
          badge={<Badge tone="error">{data.overdue_tenants_count} Overdue</Badge>}
          icon={AlertCircle}
          tone="rose"
        />
        <StatCard
          label="Security Deposits Held"
          value={formatINR(data.total_security_deposits_held)}
          sublabel="Excluded from rental income"
          icon={ShieldCheck}
          tone="blue"
        />
      </div>

      {/* Occupancy & Resident Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Active Tenants"
          value={data.total_active_tenants ?? 0}
          sublabel={`${data.paid_tenants_count} settled this cycle`}
          icon={Users}
          tone="neutral"
        />
        <StatCard
          label="Occupancy Rate"
          value={`${data.occupancy_percentage ?? 0}%`}
          sublabel={`${data.occupied_beds} of ${data.total_beds} beds`}
          icon={Building2}
          tone="blue"
        />
        <StatCard
          label="Vacant Beds"
          value={data.vacant_beds ?? 0}
          sublabel={`${data.total_rooms ?? 0} active rooms`}
          icon={BedDouble}
          tone="emerald"
        />
        <StatCard
          label="Notice / Maintenance"
          value={`${data.notice_period_beds ?? 0} / ${data.maintenance_beds ?? 0}`}
          sublabel="Notice exits · Blocked beds"
          icon={Calendar}
          tone="amber"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartContainer
          className="lg:col-span-2"
          title="Monthly Revenue Collection Trend"
          subtitle="Expected billing vs verified collected payments over the last 6 months"
          action={
            <div className="flex items-center gap-3 text-[11px] font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />
                Expected
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-navy-900" />
                Collected
              </span>
            </div>
          }
        >
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendChartData} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#64748b" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`}
                />
                <Tooltip
                  cursor={{ fill: "rgba(241, 245, 249, 0.7)" }}
                  contentStyle={{
                    borderRadius: "10px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.1)",
                    fontSize: "12px",
                  }}
                  formatter={(value) => formatINR(Number(value ?? 0))}
                />
                <Bar dataKey="Expected" fill="#cbd5e1" radius={[5, 5, 0, 0]} maxBarSize={32} />
                <Bar dataKey="Collected" fill="#0F1E36" radius={[5, 5, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartContainer>

        <ChartContainer
          title="Bed Occupancy Distribution"
          subtitle={`${data.total_beds} total beds across ${data.total_rooms ?? 0} rooms`}
        >
          {occupancyPieData.length === 0 ? (
            <EmptyState
              icon={<BedDouble className="h-5 w-5" />}
              title="No beds configured"
              description="Add rooms and beds to visualize occupancy."
            />
          ) : (
            <div className="flex h-72 flex-col justify-between">
              <div className="relative h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={occupancyPieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={3}
                    >
                      {occupancyPieData.map((_, idx) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "10px",
                        border: "1px solid #e2e8f0",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold tabular-nums text-slate-900">
                    {data.occupancy_percentage ?? 0}%
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    Occupied
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs">
                {occupancyPieData.map((item, idx) => (
                  <div key={item.name} className="flex items-center justify-between gap-1.5">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                      />
                      {item.name}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartContainer>
      </div>

      {/* Property Overview Cards */}
      {data.properties && data.properties.length > 0 ? (
        <Card>
          <CardHeader
            title="Property Overview"
            subtitle="Live room and bed capacity summary across owned properties"
            action={
              <Link
                to="/owner/settings"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>PG Settings</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <CardBody>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.properties.map((prop) => (
                <div
                  key={prop.id}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{prop.name}</p>
                      <p className="text-xs text-slate-500">{prop.city || "Active Property"}</p>
                    </div>
                    <Badge tone="info">{prop.occupancy_percentage}% occupied</Badge>
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.min(100, prop.occupancy_percentage)}%` }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
                      <p className="text-[10px] text-slate-500">Rooms</p>
                      <p className="font-semibold tabular-nums text-slate-900">
                        {prop.total_rooms}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
                      <p className="text-[10px] text-slate-500">Occupied</p>
                      <p className="font-semibold tabular-nums text-slate-900">
                        {prop.occupied_beds}/{prop.total_beds}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200/70">
                      <p className="text-[10px] text-emerald-700">Vacant</p>
                      <p className="font-semibold tabular-nums text-emerald-700">
                        {prop.vacant_beds}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* Pending Rent Table */}
      <Card>
        <CardHeader
          title="Pending & Overdue Rent Accounts"
          subtitle="Send instant in-app notifications & WhatsApp payment reminders"
          action={
            <Link
              to="/rent-management"
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
            >
              <span>Manage All Bills</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <DataTable
          columns={pendingColumns}
          data={data.pending_tenants}
          rowKey={(r) => r.rent_record_id}
          emptyState={
            <div className="p-5">
              <EmptyState
                icon={<IndianRupee className="h-5 w-5" />}
                title="No pending balances for this period"
                description="All generated bills matching your active filters are settled."
              />
            </div>
          }
        />
      </Card>

      {/* Activity, Payments, Registrations & Operations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Payment Activity */}
        <Card>
          <CardHeader
            title="Recent Payment Activity"
            subtitle="Latest verified rent receipts collected from residents"
            action={
              <Link
                to="/rent-management"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>All Payments</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
          <CardBody>
            {data.recent_transactions.length === 0 ? (
              <EmptyState
                icon={<IndianRupee className="h-5 w-5" />}
                title="No recent payments"
                description="Verified rent payments will appear here in real time."
              />
            ) : (
              <div className="space-y-2.5">
                {data.recent_transactions.map((tx) => (
                  <div
                    key={tx.payment_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {tx.tenant_name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Room {tx.room_number} · {tx.receipt_number} ·{" "}
                        <span className="uppercase">{tx.payment_method.replace("_", " ")}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums text-emerald-700">
                        {formatINR(tx.amount)}
                      </p>
                      <div className="mt-1 flex items-center justify-end gap-1.5">
                        <PaymentStatusBadge status={tx.status} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Combined Activity Feed */}
        <Card>
          <CardHeader
            title="Operations Activity Feed"
            subtitle="Payments, registrations, complaint updates & checkouts"
          />
          <CardBody>
            {!data.recent_activity || data.recent_activity.length === 0 ? (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No recent activity yet"
                description="Events across payments, onboarding, and complaints appear here."
              />
            ) : (
              <div className="space-y-2.5">
                {data.recent_activity.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            item.activity_type === "payment"
                              ? "success"
                              : item.activity_type === "registration"
                                ? "info"
                                : item.activity_type === "complaint"
                                  ? "warning"
                                  : "neutral"
                          }
                          className="capitalize"
                        >
                          {item.activity_type}
                        </Badge>
                        <span className="truncate font-semibold text-slate-900">
                          {item.title}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{item.subtitle}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {item.amount ? (
                        <p className="font-semibold tabular-nums text-slate-900">
                          {formatINR(item.amount)}
                        </p>
                      ) : null}
                      <p className="text-[10px] text-slate-400">
                        {formatDateTime(item.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recently Registered Tenants */}
        <Card>
          <CardHeader
            title="Recently Registered Tenants"
            action={
              <Link
                to="/tenants"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>All Tenants</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
          <CardBody>
            {!data.recently_registered_tenants ||
            data.recently_registered_tenants.length === 0 ? (
              <p className="text-xs text-slate-500">No active residents yet.</p>
            ) : (
              <div className="space-y-2">
                {data.recently_registered_tenants.map((t) => (
                  <Link
                    key={t.id}
                    to={`/tenants/${t.id}`}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-xs transition-colors hover:border-slate-200 hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{t.full_name}</p>
                      <p className="text-[11px] text-slate-500">
                        Room {t.room_number} · {t.bed_code} · Joined{" "}
                        {formatDate(t.joining_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <TenantStatusBadge status={t.status} />
                      <span className="font-semibold tabular-nums text-slate-900">
                        {formatINR(t.monthly_rent)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recent Complaints & Checkouts */}
        <Card>
          <CardHeader
            title="Recent Complaints & Checkouts"
            subtitle="Latest maintenance updates and settled exits"
            action={
              <Link
                to="/complaints"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                <span>Complaints</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
          <CardBody className="space-y-2.5">
            {data.recent_complaints?.slice(0, 3).map((c) => (
              <div
                key={`cmp-${c.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-100 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{c.title}</p>
                  <p className="text-[11px] text-slate-500">
                    Room {c.room_number} · {c.tenant_name}
                  </p>
                </div>
                <ComplaintStatusBadge status={c.status} />
              </div>
            ))}
            {data.recent_checkouts?.slice(0, 2).map((co) => (
              <div
                key={`co-${co.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <UserCheck className="h-4 w-4 text-slate-500" />
                  <div>
                    <p className="font-semibold text-slate-900">Checkout: {co.full_name}</p>
                    <p className="text-[11px] text-slate-500">
                      Room {co.room_number} · {co.bed_code} · Left{" "}
                      {formatDate(co.leaving_date)}
                    </p>
                  </div>
                </div>
                <Badge tone="neutral">Checked Out</Badge>
              </div>
            ))}
            {(!data.recent_complaints || data.recent_complaints.length === 0) &&
            (!data.recent_checkouts || data.recent_checkouts.length === 0) ? (
              <p className="text-xs text-slate-500">
                No recent complaint updates or checkouts recorded.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
