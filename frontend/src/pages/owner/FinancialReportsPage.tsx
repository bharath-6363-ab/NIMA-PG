import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable, PaginationBar } from "@/components/ui/DataTable";
import { FieldLabel, SearchInput, Select } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/shared/StateHelpers";
import {
  DepositStatusBadge,
  PaymentStatusBadge,
  RentStatusBadge,
} from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatDateTime, formatINR, monthName } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  downloadOwnerFinancialReport,
  fetchOwnerFinancialReports,
} from "@/services/ownerService";
import {
  FinancialDepositReportRow,
  FinancialReportRow,
  OwnerFinancialReports,
  PaymentItem,
  PaymentMethod,
  RentStatus,
} from "@/types/api";

type ReportTab = "collection" | "pending" | "overdue" | "payments" | "deposits";

const PAGE_SIZE = 10;

export function FinancialReportsPage() {
  const { showToast } = useToast();
  const today = new Date();

  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RentStatus | "">("");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "">("");
  const [activeTab, setActiveTab] = useState<ReportTab>("collection");
  const [page, setPage] = useState(1);

  const [reports, setReports] = useState<OwnerFinancialReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOwnerFinancialReports({
        month,
        year,
        search: searchQuery,
        status: statusFilter,
        payment_method: methodFilter,
      });
      setReports(data);
      setPage(1);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [month, year, searchQuery, statusFilter, methodFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  async function handleExport(fmt: "csv" | "pdf") {
    setExporting(fmt);
    try {
      await downloadOwnerFinancialReport({
        month,
        year,
        fmt,
        report_type: activeTab,
        search: searchQuery,
      });
      showToast("success", `Exported ${activeTab} report (${fmt.toUpperCase()}).`);
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setExporting(null);
    }
  }

  function paginate<T>(items: T[]): { slice: T[]; totalPages: number } {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return { slice: items.slice(start, start + PAGE_SIZE), totalPages };
  }

  if (loading && !reports) {
    return <DashboardSkeleton />;
  }

  if (error || !reports) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
        title="Unable to load financial reports"
        description={error ?? "Please verify owner access and try again."}
        action={<Button onClick={loadReports}>Retry</Button>}
      />
    );
  }

  const tabs: { key: ReportTab; label: string; count: number }[] = [
    {
      key: "collection",
      label: "Monthly Rent Collection",
      count: reports.monthly_collection_rows.length,
    },
    {
      key: "pending",
      label: "Pending Rent",
      count: reports.pending_rent_rows.length,
    },
    {
      key: "overdue",
      label: "Overdue Rent",
      count: reports.overdue_rent_rows.length,
    },
    {
      key: "payments",
      label: "Payment History",
      count: reports.payment_history_rows.length,
    },
    {
      key: "deposits",
      label: "Security Deposit Summary",
      count: reports.security_deposit_rows.length,
    },
  ];

  const activeRowsCount =
    activeTab === "collection"
      ? reports.monthly_collection_rows.length
      : activeTab === "pending"
        ? reports.pending_rent_rows.length
        : activeTab === "overdue"
          ? reports.overdue_rent_rows.length
          : activeTab === "payments"
            ? reports.payment_history_rows.length
            : reports.security_deposit_rows.length;

  const totalPages = Math.max(1, Math.ceil(activeRowsCount / PAGE_SIZE));

  const paymentColumns: ColumnDef<PaymentItem>[] = [
    {
      key: "receipt",
      header: "Receipt",
      render: (p) => (
        <span className="font-mono text-xs font-medium text-slate-900">
          {p.receipt_number ?? `PAY-${p.id}`}
        </span>
      ),
    },
    {
      key: "tenant",
      header: "Resident",
      render: (p) => (
        <span className="font-semibold text-slate-900">{p.tenant_name}</span>
      ),
    },
    {
      key: "room",
      header: "Room / Bed",
      render: (p) => (
        <span className="text-xs text-slate-600">
          Room {p.room_number} · {p.bed_code}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      render: (p) => (
        <span className="text-xs uppercase text-slate-700">
          {p.payment_method.replace("_", " ")}
        </span>
      ),
    },
    {
      key: "paidAt",
      header: "Paid At",
      render: (p) => (
        <span className="text-xs text-slate-600">
          {formatDateTime(p.paid_at ?? p.created_at)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <PaymentStatusBadge status={p.status} />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (p) => (
        <span className="font-bold text-emerald-700">{formatINR(p.amount)}</span>
      ),
    },
  ];

  const depositColumns: ColumnDef<FinancialDepositReportRow>[] = [
    {
      key: "tenant",
      header: "Resident",
      render: (d) => (
        <div>
          <p className="font-semibold text-slate-900">{d.tenant_name}</p>
          <p className="font-mono text-[11px] text-slate-500">{d.tenant_mobile}</p>
        </div>
      ),
    },
    {
      key: "room",
      header: "Room / Bed",
      render: (d) => (
        <span className="text-xs text-slate-600">
          Room {d.room_number} · {d.bed_code}
        </span>
      ),
    },
    {
      key: "held",
      header: "Held",
      align: "right",
      render: (d) => (
        <span className="font-semibold text-slate-900">{formatINR(d.amount_held)}</span>
      ),
    },
    {
      key: "deductions",
      header: "Deductions",
      align: "right",
      render: (d) => (
        <span className="text-rose-700">{formatINR(d.deduction_amount)}</span>
      ),
    },
    {
      key: "refunded",
      header: "Refunded",
      align: "right",
      render: (d) => <span className="text-slate-600">{formatINR(d.refund_amount)}</span>,
    },
    {
      key: "refundable",
      header: "Refundable Balance",
      align: "right",
      render: (d) => (
        <span className="font-bold text-emerald-700">
          {formatINR(d.refundable_balance)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (d) => <DepositStatusBadge status={d.paid_status} />,
    },
  ];

  const rentReportColumns: ColumnDef<FinancialReportRow>[] = [
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
      header: "Room / Bed",
      render: (row) => (
        <span className="text-xs text-slate-600">
          Room {row.room_number} · {row.bed_code}
        </span>
      ),
    },
    {
      key: "breakdown",
      header: "Breakdown",
      render: (row) => (
        <span className="text-xs text-slate-600">
          {formatINR(row.base_rent)} + {formatINR(row.food_charges)}
          {parseFloat(row.other_charges) > 0 ? ` + ${formatINR(row.other_charges)}` : ""}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (row) => (
        <span className="font-semibold text-slate-900">{formatINR(row.total_amount)}</span>
      ),
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      render: (row) => (
        <span className="font-semibold text-emerald-700">
          {formatINR(row.amount_paid)}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (row) => (
        <span className="font-bold text-brand-700">{formatINR(row.balance_due)}</span>
      ),
    },
    {
      key: "due",
      header: "Due Date",
      render: (row) => (
        <span className="text-xs text-slate-600">
          {formatDate(row.due_date)}
          {row.days_overdue > 0 ? (
            <span className="ml-1 font-semibold text-rose-600">({row.days_overdue}d)</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <RentStatusBadge status={row.status} />,
    },
  ];

  const rentRows =
    activeTab === "pending"
      ? reports.pending_rent_rows
      : activeTab === "overdue"
        ? reports.overdue_rent_rows
        : reports.monthly_collection_rows;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: reports.pg_name },
          { label: "Owner", to: "/owner" },
          { label: "Financial Reports" },
        ]}
        title="Financial & Audit Reports"
        subtitle="Inspect rent collections, pending & overdue balances, verified payment receipts, and deposits separately with CSV & PDF exports."
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              loading={exporting === "csv"}
              onClick={() => void handleExport("csv")}
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Export CSV</span>
            </Button>
            <Button
              size="sm"
              loading={exporting === "pdf"}
              onClick={() => void handleExport("pdf")}
            >
              <Download className="h-4 w-4" />
              <span>Export PDF</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadReports}
              aria-label="Refresh reports"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <FieldLabel htmlFor="rep-month" label="Billing Month" />
            <Select
              id="rep-month"
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
            <FieldLabel htmlFor="rep-year" label="Billing Year" />
            <Select
              id="rep-year"
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
          <div>
            <FieldLabel htmlFor="rep-status" label="Rent Status Filter" />
            <Select
              id="rep-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RentStatus | "")}
            >
              <option value="">All Rent Statuses</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="pending">Pending</option>
              <option value="overdue">Overdue</option>
            </Select>
          </div>
          <div>
            <FieldLabel htmlFor="rep-method" label="Payment Method" />
            <Select
              id="rep-method"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | "")}
            >
              <option value="">All Methods</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="net_banking">Net Banking</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
            </Select>
          </div>
          <div>
            <FieldLabel htmlFor="rep-search" label="Search Resident / Room" />
            <SearchInput
              id="rep-search"
              placeholder="Name, room, receipt..."
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>
        </CardBody>
      </Card>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Expected Rent"
          value={formatINR(reports.total_expected_rent)}
          icon={IndianRupee}
          tone="navy"
        />
        <StatCard
          label="Collected Rent"
          value={formatINR(reports.total_collected_rent)}
          sublabel={`${reports.collection_rate_percentage}% collection rate`}
          icon={TrendingUp}
          tone="emerald"
        />
        <StatCard
          label="Pending Balance"
          value={formatINR(reports.total_pending_rent)}
          icon={Wallet}
          tone="amber"
        />
        <StatCard
          label="Overdue Total"
          value={formatINR(reports.total_overdue_rent)}
          icon={AlertCircle}
          tone="rose"
        />
        <StatCard
          label="Deposits Held"
          value={formatINR(reports.total_security_deposits_held)}
          sublabel="Excluded from rent income"
          icon={ShieldCheck}
          tone="blue"
        />
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-200/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setActiveTab(t.key);
              setPage(1);
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
              activeTab === t.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>{t.label}</span>
            <Badge tone={activeTab === t.key ? "info" : "neutral"}>{t.count}</Badge>
          </button>
        ))}
      </div>

      {/* Active Report Table */}
      <Card>
        <CardHeader
          title={tabs.find((t) => t.key === activeTab)?.label ?? "Report"}
          subtitle={`${monthName(reports.month)} ${reports.year} · ${reports.pg_name}`}
        />
        {activeRowsCount === 0 ? (
          <CardBody>
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="No matching records"
              description="Try another billing period or clear search/status filters."
            />
          </CardBody>
        ) : activeTab === "payments" ? (
          <DataTable
            columns={paymentColumns}
            data={paginate(reports.payment_history_rows).slice}
            rowKey={(p) => p.id}
          />
        ) : activeTab === "deposits" ? (
          <DataTable
            columns={depositColumns}
            data={paginate(reports.security_deposit_rows).slice}
            rowKey={(d) => d.tenant_id}
          />
        ) : (
          <DataTable
            columns={rentReportColumns}
            data={paginate(rentRows).slice}
            rowKey={(r) => r.rent_record_id}
          />
        )}

        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={activeRowsCount}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
