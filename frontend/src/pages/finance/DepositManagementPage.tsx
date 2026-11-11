import { useCallback, useEffect, useState } from "react";
import {
  History,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
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
import { DepositStatusBadge } from "@/components/shared/StatusBadges";
import { EmptyState, LoadingState } from "@/components/shared/StateHelpers";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  fetchAllDeposits,
  fetchTenantDepositDetail,
  recordDepositTransaction,
} from "@/services/financeService";
import { DepositTransactionType, SecurityDeposit } from "@/types/api";

export function DepositManagementPage() {
  const { showToast } = useToast();
  const [deposits, setDeposits] = useState<SecurityDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Transaction modal
  const [entryTarget, setEntryTarget] = useState<SecurityDeposit | null>(null);
  const [txnType, setTxnType] = useState<DepositTransactionType>("deduction");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnMethod, setTxnMethod] = useState("bank_transfer");
  const [txnRef, setTxnRef] = useState("");
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [txnReason, setTxnReason] = useState("");
  const [savingTxn, setSavingTxn] = useState(false);

  // History modal
  const [historyDeposit, setHistoryDeposit] = useState<SecurityDeposit | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadDeposits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllDeposits();
      setDeposits(data);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeposits();
  }, [loadDeposits]);

  function openEntryModal(dep: SecurityDeposit) {
    setEntryTarget(dep);
    setTxnType("deduction");
    setTxnAmount("");
    setTxnMethod("bank_transfer");
    setTxnRef("");
    setTxnDate(new Date().toISOString().slice(0, 10));
    setTxnReason("");
  }

  async function handleSubmitTransaction() {
    if (!entryTarget?.tenant_id) return;
    const numeric = parseFloat(txnAmount);
    if (Number.isNaN(numeric) || numeric <= 0) {
      showToast("error", "Enter a valid positive amount.");
      return;
    }

    setSavingTxn(true);
    try {
      await recordDepositTransaction(entryTarget.tenant_id, {
        transaction_type: txnType,
        amount: numeric.toFixed(2),
        payment_method: txnMethod,
        reference_id: txnRef.trim() || undefined,
        reason: txnReason.trim() || undefined,
        transaction_date: txnDate || undefined,
      });
      showToast("success", "Security deposit ledger updated.");
      setEntryTarget(null);
      await loadDeposits();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSavingTxn(false);
    }
  }

  async function openHistory(dep: SecurityDeposit) {
    if (!dep.tenant_id) return;
    setLoadingDetail(true);
    setHistoryDeposit(dep);
    try {
      const fresh = await fetchTenantDepositDetail(dep.tenant_id);
      setHistoryDeposit(fresh);
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setLoadingDetail(false);
    }
  }

  const filtered = deposits.filter((dep) => {
    if (statusFilter && dep.paid_status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const hay = `${dep.tenant_name} ${dep.tenant_mobile} ${dep.room_number} ${dep.bed_code}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const totalHeld = deposits.reduce((s, d) => s + parseFloat(d.amount_held), 0);
  const totalRefundable = deposits.reduce(
    (s, d) => s + parseFloat(d.refundable_balance),
    0
  );
  const totalDeductions = deposits.reduce(
    (s, d) => s + parseFloat(d.deduction_amount),
    0
  );

  const columns: ColumnDef<SecurityDeposit>[] = [
    {
      key: "tenant",
      header: "Resident",
      render: (dep) => (
        <div>
          <p className="font-semibold text-slate-900">{dep.tenant_name}</p>
          <p className="text-[11px] text-slate-500">
            <span className="font-mono">{dep.tenant_mobile}</span> ·{" "}
            <span className="capitalize">{dep.tenant_status.replace("_", " ")}</span>
          </p>
        </div>
      ),
    },
    {
      key: "room",
      header: "Room / Bed",
      render: (dep) => (
        <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
          Room {dep.room_number} · {dep.bed_code}
        </span>
      ),
    },
    {
      key: "held",
      header: "Held",
      align: "right",
      render: (dep) => (
        <span className="font-semibold text-slate-900">{formatINR(dep.amount_held)}</span>
      ),
    },
    {
      key: "deduction",
      header: "Deductions",
      align: "right",
      render: (dep) => (
        <span className="text-rose-700">{formatINR(dep.deduction_amount)}</span>
      ),
    },
    {
      key: "refunded",
      header: "Refunded",
      align: "right",
      render: (dep) => (
        <span className="text-slate-600">{formatINR(dep.refund_amount)}</span>
      ),
    },
    {
      key: "balance",
      header: "Refundable Balance",
      align: "right",
      render: (dep) => (
        <span className="font-bold text-emerald-700">
          {formatINR(dep.refundable_balance)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (dep) => <DepositStatusBadge status={dep.paid_status} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (dep) => (
        <div className="inline-flex gap-1.5">
          <Button size="sm" onClick={() => openEntryModal(dep)}>
            <PlusCircle className="h-3.5 w-3.5" />
            <span>Record Entry</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => openHistory(dep)}>
            <History className="h-3.5 w-3.5" />
            <span>Ledger</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Finance" }, { label: "Security Deposits" }]}
        title="Security Deposit Ledger"
        subtitle="Track refundable resident deposits separately from rental revenue, including deductions and settlements."
        actions={
          <Button variant="outline" size="sm" onClick={loadDeposits}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
        }
      />

      {loading && deposits.length === 0 ? (
        <>
          <StatGridSkeleton count={3} />
          <TableSkeleton rows={6} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Total Deposit Held"
              value={formatINR(totalHeld)}
              sublabel="Accounted separately from rent"
              icon={ShieldCheck}
              tone="navy"
            />
            <StatCard
              label="Net Refundable Balance"
              value={formatINR(totalRefundable)}
              icon={Wallet}
              tone="emerald"
            />
            <StatCard
              label="Total Deductions Applied"
              value={formatINR(totalDeductions)}
              icon={History}
              tone="rose"
            />
          </div>

          <Card>
            <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
              <div>
                <FieldLabel htmlFor="dep-search" label="Search Tenant / Room" />
                <SearchInput
                  id="dep-search"
                  placeholder="Name, mobile, room..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              </div>
              <div>
                <FieldLabel htmlFor="dep-status" label="Deposit Status" />
                <Select
                  id="dep-status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="held">Held</option>
                  <option value="pending">Pending</option>
                  <option value="partially_refunded">Partially Refunded</option>
                  <option value="refunded">Refunded</option>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("");
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tenant Deposit Accounts"
              subtitle={`${filtered.length} deposit account${filtered.length === 1 ? "" : "s"}`}
            />
            {loading ? (
              <CardBody>
                <TableSkeleton rows={5} />
              </CardBody>
            ) : error ? (
              <CardBody>
                <EmptyState
                  icon={<ShieldCheck className="h-5 w-5 text-rose-500" />}
                  title="Could not load security deposits"
                  description={error}
                  action={<Button onClick={loadDeposits}>Retry</Button>}
                />
              </CardBody>
            ) : (
              <DataTable
                columns={columns}
                data={filtered}
                rowKey={(dep) => dep.id ?? dep.tenant_mobile}
                emptyState={
                  <div className="p-5">
                    <EmptyState
                      icon={<ShieldCheck className="h-5 w-5" />}
                      title="No deposit accounts found"
                      description="Security deposit ledgers are created automatically when tenants are registered."
                    />
                  </div>
                }
              />
            )}
          </Card>
        </>
      )}

      {/* Record Deposit Transaction Modal */}
      <Modal
        open={Boolean(entryTarget)}
        onClose={() => setEntryTarget(null)}
        title="Record Security Deposit Transaction"
        subtitle={
          entryTarget
            ? `${entryTarget.tenant_name} · Refundable Balance ${formatINR(entryTarget.refundable_balance)}`
            : undefined
        }
      >
        {entryTarget ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="dep-txn-type" label="Transaction Type" required />
                <Select
                  id="dep-txn-type"
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value as DepositTransactionType)}
                >
                  <option value="deposit_received">Deposit Received</option>
                  <option value="deduction">Authorized Deduction</option>
                  <option value="refund">Deposit Refund</option>
                </Select>
              </div>
              <div>
                <FieldLabel
                  htmlFor="dep-txn-amount"
                  label="Amount (INR)"
                  required
                  hint={
                    txnType !== "deposit_received"
                      ? `Max ${formatINR(entryTarget.refundable_balance)}`
                      : undefined
                  }
                />
                <Input
                  id="dep-txn-amount"
                  type="number"
                  min="1"
                  step="0.01"
                  value={txnAmount}
                  onChange={(e) => setTxnAmount(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <FieldLabel htmlFor="dep-txn-method" label="Method" />
                <Select
                  id="dep-txn-method"
                  value={txnMethod}
                  onChange={(e) => setTxnMethod(e.target.value)}
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="dep-txn-ref" label="Reference ID" />
                <Input
                  id="dep-txn-ref"
                  placeholder="UTR / Ref"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="dep-txn-date" label="Date" />
                <Input
                  id="dep-txn-date"
                  type="date"
                  value={txnDate}
                  onChange={(e) => setTxnDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <FieldLabel
                htmlFor="dep-txn-reason"
                label="Reason / Notes"
                hint={txnType === "deduction" ? "Recommended for deductions" : undefined}
              />
              <Textarea
                id="dep-txn-reason"
                placeholder="e.g., Wall repainting / notice adjustment / full checkout refund"
                value={txnReason}
                onChange={(e) => setTxnReason(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEntryTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitTransaction} loading={savingTxn}>
                Save Deposit Entry
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Deposit Ledger History Modal */}
      <Modal
        open={Boolean(historyDeposit)}
        onClose={() => setHistoryDeposit(null)}
        title={
          historyDeposit
            ? `Deposit Ledger — ${historyDeposit.tenant_name}`
            : "Deposit Ledger"
        }
        maxWidthClass="max-w-2xl"
      >
        {loadingDetail ? (
          <LoadingState label="Loading transaction history..." />
        ) : historyDeposit ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 rounded-xl bg-slate-50/80 p-3 text-xs">
              <div>
                <span className="text-slate-500">Held</span>
                <p className="font-bold tabular-nums text-slate-900">
                  {formatINR(historyDeposit.amount_held)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Deductions</span>
                <p className="font-bold tabular-nums text-rose-700">
                  {formatINR(historyDeposit.deduction_amount)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Refunded</span>
                <p className="font-bold tabular-nums text-slate-900">
                  {formatINR(historyDeposit.refund_amount)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Refundable</span>
                <p className="font-bold tabular-nums text-emerald-700">
                  {formatINR(historyDeposit.refundable_balance)}
                </p>
              </div>
            </div>

            {historyDeposit.transactions.length === 0 ? (
              <p className="text-xs text-slate-500">No ledger transactions yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/90 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Method / Ref</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyDeposit.transactions.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {formatDate(t.transaction_date)}
                        </td>
                        <td className="px-3 py-2 capitalize font-medium text-slate-900">
                          {t.transaction_type.replace("_", " ")}
                        </td>
                        <td className="px-3 py-2 font-semibold tabular-nums text-slate-900">
                          {formatINR(t.amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <span className="uppercase">
                            {t.payment_method?.replace("_", " ") ?? "—"}
                          </span>
                          {t.reference_id ? ` · ${t.reference_id}` : ""}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{t.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
