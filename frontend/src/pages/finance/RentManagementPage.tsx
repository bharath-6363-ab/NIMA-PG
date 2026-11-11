import { useCallback, useEffect, useState } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  History,
  IndianRupee,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input, SearchInput, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { ReceiptModal } from "@/components/shared/ReceiptModal";
import { EmptyState, LoadingState } from "@/components/shared/StateHelpers";
import {
  PaymentStatusBadge,
  RentStatusBadge,
} from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatDateTime, formatINR, monthName } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  downloadFinanceReceiptPdf,
  fetchFinanceReceiptDetail,
  fetchPayments,
  fetchRentRecords,
  fetchTenantRentHistory,
  generateMonthlyRent,
  recordOfflinePayment,
  updateRentRecordCharges,
} from "@/services/financeService";
import {
  GenerateRentResponse,
  PaymentItem,
  PaymentMethod,
  ReceiptDetail,
  RentRecord,
} from "@/types/api";

const OFFLINE_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer (NEFT / IMPS / RTGS)" },
  { value: "upi", label: "Direct UPI Transfer" },
];

export function RentManagementPage() {
  const { showToast } = useToast();
  const today = new Date();

  const [records, setRecords] = useState<RentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterMonth, setFilterMonth] = useState<string>("");
  const [filterYear, setFilterYear] = useState<string>(String(today.getFullYear()));
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Generate Rent modal
  const [genOpen, setGenOpen] = useState(false);
  const [genMonth, setGenMonth] = useState<number>(today.getMonth() + 1);
  const [genYear, setGenYear] = useState<number>(today.getFullYear());
  const [generating, setGenerating] = useState(false);
  const [lastGenSummary, setLastGenSummary] = useState<GenerateRentResponse | null>(null);

  // Offline Payment modal
  const [payTarget, setPayTarget] = useState<RentRecord | null>(null);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payRef, setPayRef] = useState<string>("");
  const [payDate, setPayDate] = useState<string>(today.toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState<string>("");
  const [recordingPay, setRecordingPay] = useState(false);

  // Edit Other Charges modal
  const [editTarget, setEditTarget] = useState<RentRecord | null>(null);
  const [editOtherCharges, setEditOtherCharges] = useState<string>("0");
  const [editOtherNote, setEditOtherNote] = useState<string>("");
  const [editDueDate, setEditDueDate] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Tenant History & Receipts modal
  const [historyTarget, setHistoryTarget] = useState<RentRecord | null>(null);
  const [historyBills, setHistoryBills] = useState<RentRecord[]>([]);
  const [historyPayments, setHistoryPayments] = useState<PaymentItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Receipt modal
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptDetail | null>(null);
  const [activeReceiptPaymentId, setActiveReceiptPaymentId] = useState<number | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRentRecords({
        month: filterMonth ? Number(filterMonth) : undefined,
        year: filterYear ? Number(filterYear) : undefined,
        status: filterStatus || undefined,
        search: searchQuery.trim() || undefined,
      });
      setRecords(data);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [filterMonth, filterYear, filterStatus, searchQuery]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  async function handleGenerateRent() {
    setGenerating(true);
    try {
      const result = await generateMonthlyRent({
        billing_month: genMonth,
        billing_year: genYear,
      });
      setLastGenSummary(result);
      showToast(
        "success",
        `Generated ${result.created_count} bills (${result.skipped_existing_count} already existed, ${result.ineligible_count} ineligible).`
      );
      setGenOpen(false);
      setFilterMonth(String(genMonth));
      setFilterYear(String(genYear));
      await loadRecords();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setGenerating(false);
    }
  }

  function openOfflinePaymentModal(record: RentRecord) {
    setPayTarget(record);
    setPayAmount(record.balance_due);
    setPayMethod("cash");
    setPayRef("");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayNotes("");
  }

  async function handleRecordOfflinePayment() {
    if (!payTarget) return;
    const num = parseFloat(payAmount);
    if (Number.isNaN(num) || num <= 0) {
      showToast("error", "Enter a valid positive amount.");
      return;
    }

    setRecordingPay(true);
    try {
      const payment = await recordOfflinePayment({
        rent_record_id: payTarget.id,
        amount: num.toFixed(2),
        payment_method: payMethod,
        transaction_ref: payRef.trim() || undefined,
        payment_date: payDate || undefined,
        notes: payNotes.trim() || undefined,
      });
      showToast(
        "success",
        `Recorded ${formatINR(payment.amount)} (${payment.receipt_number ?? "Verified"}).`
      );
      setPayTarget(null);
      await loadRecords();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setRecordingPay(false);
    }
  }

  function openEditModal(record: RentRecord) {
    setEditTarget(record);
    setEditOtherCharges(record.other_charges);
    setEditOtherNote(record.other_charges_note ?? "");
    setEditDueDate(record.due_date);
  }

  async function handleSaveCharges() {
    if (!editTarget) return;
    const num = parseFloat(editOtherCharges || "0");
    if (Number.isNaN(num) || num < 0) {
      showToast("error", "Other charges must be zero or positive.");
      return;
    }

    setSavingEdit(true);
    try {
      await updateRentRecordCharges(editTarget.id, {
        other_charges: num.toFixed(2),
        other_charges_note: editOtherNote.trim() || null,
        due_date: editDueDate || undefined,
      });
      showToast("success", "Rent bill updated.");
      setEditTarget(null);
      await loadRecords();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function openTenantHistory(record: RentRecord) {
    setHistoryTarget(record);
    setLoadingHistory(true);
    try {
      const [bills, payments] = await Promise.all([
        fetchTenantRentHistory(record.tenant_id),
        fetchPayments(record.tenant_id),
      ]);
      setHistoryBills(bills);
      setHistoryPayments(payments);
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleOpenReceipt(paymentId: number) {
    try {
      const detail = await fetchFinanceReceiptDetail(paymentId);
      setActiveReceipt(detail);
      setActiveReceiptPaymentId(paymentId);
      setReceiptOpen(true);
    } catch (err) {
      showToast("error", extractApiError(err));
    }
  }

  async function handleDownloadReceipt(paymentId: number, receiptNumber: string) {
    setDownloadingPdf(true);
    try {
      await downloadFinanceReceiptPdf(paymentId, receiptNumber);
      showToast("success", "PDF receipt downloaded.");
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setDownloadingPdf(false);
    }
  }

  const totalBilled = records.reduce((s, r) => s + parseFloat(r.total_amount), 0);
  const totalPaid = records.reduce((s, r) => s + parseFloat(r.amount_paid), 0);
  const totalBalance = records.reduce((s, r) => s + parseFloat(r.balance_due), 0);

  const columns: ColumnDef<RentRecord>[] = [
    {
      key: "tenant",
      header: "Resident",
      render: (rec) => (
        <div>
          <p className="font-semibold text-slate-900">{rec.tenant_name}</p>
          <p className="font-mono text-[11px] text-slate-500">{rec.tenant_mobile}</p>
        </div>
      ),
    },
    {
      key: "allocation",
      header: "Room / Bed",
      render: (rec) => (
        <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
          Room {rec.room_number} · {rec.bed_code}
        </span>
      ),
    },
    {
      key: "period",
      header: "Period",
      render: (rec) => (
        <div className="whitespace-nowrap">
          <p className="text-xs font-semibold text-slate-900">
            {monthName(rec.billing_month)} {rec.billing_year}
          </p>
          <p className="text-[11px] text-slate-400">Due {formatDate(rec.due_date)}</p>
        </div>
      ),
    },
    {
      key: "breakdown",
      header: "Breakdown",
      render: (rec) => (
        <div className="text-xs text-slate-600">
          <span>Rent {formatINR(rec.base_rent)}</span> ·{" "}
          <span>Food {formatINR(rec.food_charges)}</span>
          {parseFloat(rec.other_charges) > 0 ? (
            <div className="text-[11px] text-brand-700">
              + Other {formatINR(rec.other_charges)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "totals",
      header: "Total / Paid",
      align: "right",
      render: (rec) => (
        <div className="whitespace-nowrap">
          <p className="font-semibold text-slate-900">{formatINR(rec.total_amount)}</p>
          <p className="text-[11px] text-emerald-700">Paid {formatINR(rec.amount_paid)}</p>
        </div>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (rec) => (
        <span className="font-bold text-slate-900 whitespace-nowrap">
          {formatINR(rec.balance_due)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (rec) => <RentStatusBadge status={rec.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (rec) => {
        const hasDue = parseFloat(rec.balance_due) > 0;
        return (
          <div className="inline-flex flex-wrap justify-end gap-1.5">
            {hasDue ? (
              <Button size="sm" onClick={() => openOfflinePaymentModal(rec)}>
                <Wallet className="h-3.5 w-3.5" />
                <span>Pay</span>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => openEditModal(rec)}
              title="Edit authorized other charges or due date"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Adjust</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openTenantHistory(rec)}
              title="View tenant billing history & PDF receipts"
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Receipts</span>
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Finance" }, { label: "Rent & Payments" }]}
        title="Rent & Payment Operations"
        subtitle="Generate monthly rent bills, adjust authorized charges, record offline payments, and issue verified PDF receipts."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={loadRecords}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
            <Button size="sm" onClick={() => setGenOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              <span>Generate Monthly Rent</span>
            </Button>
          </>
        }
      />

      {lastGenSummary ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-xs text-slate-800">
          <div>
            <span className="font-semibold">
              {monthName(lastGenSummary.billing_month)} {lastGenSummary.billing_year} generation summary:{" "}
            </span>
            <span>
              Created {lastGenSummary.created_count} · Skipped duplicates{" "}
              {lastGenSummary.skipped_existing_count} · Ineligible{" "}
              {lastGenSummary.ineligible_count}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLastGenSummary(null)}
            className="font-medium text-brand-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {loading && records.length === 0 ? (
        <>
          <StatGridSkeleton count={3} />
          <TableSkeleton rows={6} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Total Billed (Filtered)"
              value={formatINR(totalBilled)}
              sublabel={`${records.length} billing records`}
              icon={IndianRupee}
              tone="navy"
            />
            <StatCard
              label="Collected Amount"
              value={formatINR(totalPaid)}
              icon={CheckCircle2}
              tone="emerald"
            />
            <StatCard
              label="Outstanding Balance"
              value={formatINR(totalBalance)}
              icon={Wallet}
              tone={totalBalance > 0 ? "amber" : "emerald"}
            />
          </div>

          <Card>
            <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <FieldLabel htmlFor="rent-search" label="Search Tenant / Room" />
                <SearchInput
                  id="rent-search"
                  placeholder="Name, mobile, room..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              </div>

              <div>
                <FieldLabel htmlFor="rent-month" label="Billing Month" />
                <Select
                  id="rent-month"
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                >
                  <option value="">All Months</option>
                  {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                    <option key={m} value={String(m)}>
                      {monthName(m)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <FieldLabel htmlFor="rent-year" label="Billing Year" />
                <Select
                  id="rent-year"
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                >
                  <option value="">All Years</option>
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
                <FieldLabel htmlFor="rent-status" label="Payment Status" />
                <Select
                  id="rent-status"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="partial">Partial</option>
                  <option value="overdue">Overdue</option>
                  <option value="paid">Paid</option>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setFilterMonth("");
                    setFilterYear("");
                    setFilterStatus("");
                    setSearchQuery("");
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tenant Rent Records"
              subtitle={`${records.length} record${records.length === 1 ? "" : "s"} matching filters`}
            />
            {loading ? (
              <CardBody>
                <TableSkeleton rows={5} />
              </CardBody>
            ) : error ? (
              <CardBody>
                <EmptyState
                  icon={<IndianRupee className="h-5 w-5 text-rose-500" />}
                  title="Could not load rent records"
                  description={error}
                  action={<Button onClick={loadRecords}>Retry</Button>}
                />
              </CardBody>
            ) : (
              <DataTable
                columns={columns}
                data={records}
                rowKey={(r) => r.id}
                emptyState={
                  <div className="p-5">
                    <EmptyState
                      icon={<IndianRupee className="h-5 w-5" />}
                      title="No rent records found"
                      description="Generate bills for the month or adjust your search and status filters."
                      action={
                        <Button onClick={() => setGenOpen(true)}>
                          <CalendarPlus className="h-4 w-4" />
                          <span>Generate Monthly Rent</span>
                        </Button>
                      }
                    />
                  </div>
                }
              />
            )}
          </Card>
        </>
      )}

      {/* Generate Monthly Rent Modal */}
      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate Monthly Rent Bills"
        subtitle="Automatically applies joining/checkout eligibility and mid-month proration without duplicating existing bills."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="gen-month" label="Billing Month" required />
              <Select
                id="gen-month"
                value={String(genMonth)}
                onChange={(e) => setGenMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                  <option key={m} value={String(m)}>
                    {monthName(m)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="gen-year" label="Billing Year" required />
              <Select
                id="gen-year"
                value={String(genYear)}
                onChange={(e) => setGenYear(Number(e.target.value))}
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
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
            Historical rent records preserve their original terms even if a tenant&apos;s monthly rent is later changed.
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setGenOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateRent} loading={generating}>
              Generate Rent Records
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record Offline Payment Modal */}
      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title="Record Offline Rent Payment"
        subtitle={
          payTarget
            ? `${payTarget.tenant_name} · ${monthName(payTarget.billing_month)} ${payTarget.billing_year} (Balance ${formatINR(payTarget.balance_due)})`
            : undefined
        }
      >
        {payTarget ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel
                  htmlFor="offline-amount"
                  label="Payment Amount (INR)"
                  required
                  hint={`Due ${formatINR(payTarget.balance_due)}`}
                />
                <Input
                  id="offline-amount"
                  type="number"
                  min="1"
                  max={payTarget.balance_due}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="offline-method" label="Payment Method" required />
                <Select
                  id="offline-method"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                >
                  {OFFLINE_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="offline-date" label="Payment Date" />
                <Input
                  id="offline-date"
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel
                  htmlFor="offline-ref"
                  label="Transaction / Reference ID"
                  hint="Optional for Cash"
                />
                <Input
                  id="offline-ref"
                  placeholder="UTR / UPI Ref / Receipt Ref"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="offline-notes" label="Remarks / Notes" />
              <Textarea
                id="offline-notes"
                placeholder="e.g., Partial cash received at front desk"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPayTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleRecordOfflinePayment} loading={recordingPay}>
                Save Payment &amp; Generate Receipt
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Adjust Other Authorized Charges Modal */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title="Adjust Authorized Rent Charges"
        subtitle={
          editTarget
            ? `${editTarget.tenant_name} · ${monthName(editTarget.billing_month)} ${editTarget.billing_year}`
            : undefined
        }
      >
        {editTarget ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50/80 p-3 text-xs">
              <div>
                <span className="text-slate-500">Locked Room Rent</span>
                <p className="font-semibold tabular-nums text-slate-900">
                  {formatINR(editTarget.base_rent)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Locked Food Charges</span>
                <p className="font-semibold tabular-nums text-slate-900">
                  {formatINR(editTarget.food_charges)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="adj-other" label="Other Authorized Charges (INR)" />
                <Input
                  id="adj-other"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editOtherCharges}
                  onChange={(e) => setEditOtherCharges(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="adj-due" label="Due Date" />
                <Input
                  id="adj-due"
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="adj-note" label="Reason / Description" />
              <Input
                id="adj-note"
                placeholder="e.g., Parking fee or late key replacement"
                value={editOtherNote}
                onChange={(e) => setEditOtherNote(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCharges} loading={savingEdit}>
                Save Changes
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Tenant Rent History & Receipts Modal */}
      <Modal
        open={Boolean(historyTarget)}
        onClose={() => setHistoryTarget(null)}
        title={
          historyTarget
            ? `Rent & Payment History — ${historyTarget.tenant_name}`
            : "Tenant History"
        }
        maxWidthClass="max-w-3xl"
      >
        {loadingHistory ? (
          <LoadingState label="Loading tenant rent & receipt history..." />
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Historical Monthly Bills
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/90 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Period</th>
                      <th className="px-3 py-2 font-medium">Room / Bed</th>
                      <th className="px-3 py-2 font-medium">Total</th>
                      <th className="px-3 py-2 font-medium">Paid</th>
                      <th className="px-3 py-2 font-medium">Balance</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyBills.map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {monthName(b.billing_month)} {b.billing_year}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {b.room_number} · {b.bed_code}
                        </td>
                        <td className="px-3 py-2 font-semibold tabular-nums">
                          {formatINR(b.total_amount)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-emerald-700">
                          {formatINR(b.amount_paid)}
                        </td>
                        <td className="px-3 py-2 font-semibold tabular-nums text-brand-700">
                          {formatINR(b.balance_due)}
                        </td>
                        <td className="px-3 py-2">
                          <RentStatusBadge status={b.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payment Transactions &amp; Official Receipts
              </h3>
              {historyPayments.length === 0 ? (
                <p className="text-xs text-slate-500">No payments recorded yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/90 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Receipt</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Method</th>
                        <th className="px-3 py-2 font-medium">Amount</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">PDF Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {historyPayments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-3 py-2 font-mono font-medium text-slate-900">
                            {p.receipt_number ?? `PAY-${p.id}`}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {formatDateTime(p.paid_at ?? p.created_at)}
                          </td>
                          <td className="px-3 py-2 uppercase text-slate-700">
                            {p.payment_method.replace("_", " ")}
                          </td>
                          <td className="px-3 py-2 font-semibold tabular-nums text-slate-900">
                            {formatINR(p.amount)}
                          </td>
                          <td className="px-3 py-2">
                            <PaymentStatusBadge status={p.status} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            {p.status === "verified_paid" ? (
                              <div className="inline-flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenReceipt(p.id)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={downloadingPdf}
                                  onClick={() =>
                                    handleDownloadReceipt(
                                      p.id,
                                      p.receipt_number ?? `receipt-${p.id}`
                                    )
                                  }
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">N/A</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ReceiptModal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        receipt={activeReceipt}
        downloading={downloadingPdf}
        onDownloadPdf={() => {
          if (activeReceipt && activeReceiptPaymentId) {
            void handleDownloadReceipt(
              activeReceiptPaymentId,
              activeReceipt.receipt_number
            );
          }
        }}
      />
    </div>
  );
}
