import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  FileText,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { ReceiptModal } from "@/components/shared/ReceiptModal";
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
  createRentPaymentOrder,
  downloadReceiptPdf,
  fetchReceiptDetail,
  fetchTenantRentSummary,
  markRentPaymentFailed,
  verifyRentPayment,
} from "@/services/tenantService";
import {
  PaymentItem,
  PaymentMethod,
  ReceiptDetail,
  RentRecord,
  TenantRentSummary,
} from "@/types/api";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on?: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void;
    };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const ONLINE_METHODS: {
  id: PaymentMethod;
  label: string;
  subtitle: string;
  icon: typeof Smartphone;
}[] = [
  { id: "upi", label: "UPI", subtitle: "GPay, PhonePe, Paytm", icon: Smartphone },
  { id: "card", label: "Card", subtitle: "Debit / Credit Card", icon: CreditCard },
  { id: "net_banking", label: "Net Banking", subtitle: "All Indian Banks", icon: Landmark },
];

export function OnlineRentPage() {
  const { showToast } = useToast();
  const [summary, setSummary] = useState<TenantRentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("upi");
  const [payAmount, setPayAmount] = useState<string>("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptDetail | null>(null);
  const [activeReceiptPaymentId, setActiveReceiptPaymentId] = useState<number | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rentData = await fetchTenantRentSummary();
      setSummary(rentData);
      if (rentData.current_rent && parseFloat(rentData.current_rent.balance_due) > 0) {
        setPayAmount(rentData.current_rent.balance_due);
      } else {
        setPayAmount("");
      }
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleStartPayment() {
    if (!summary?.current_rent) return;
    if (!summary.razorpay_enabled) {
      showToast(
        "info",
        "Online payment gateway is not configured in this environment."
      );
      return;
    }

    const numericAmount = parseFloat(payAmount || summary.current_rent.balance_due);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      showToast("error", "Enter a valid positive payment amount.");
      return;
    }

    setCreatingOrder(true);
    try {
      const order = await createRentPaymentOrder({
        rent_record_id: summary.current_rent.id,
        payment_method: selectedMethod,
        amount: numericAmount.toFixed(2),
      });

      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay || !order.razorpay_key_id) {
        await markRentPaymentFailed({
          payment_id: order.payment_id,
          gateway_order_id: order.gateway_order_id,
          reason: "Unable to initialize Razorpay checkout script.",
        });
        showToast("error", "Could not load Razorpay checkout. Please try again.");
        await loadData();
        return;
      }

      const rzp = new window.Razorpay({
        key: order.razorpay_key_id,
        amount: order.amount_paise,
        currency: order.currency,
        name: summary.pg_name,
        description: `Rent for ${monthName(summary.current_rent.billing_month)} ${summary.current_rent.billing_year}`,
        order_id: order.gateway_order_id,
        prefill: {
          name: summary.tenant_name,
        },
        theme: { color: "#0F1E36" },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          setVerifying(true);
          try {
            const verified = await verifyRentPayment({
              payment_id: order.payment_id,
              gateway_order_id: response.razorpay_order_id,
              gateway_payment_id: response.razorpay_payment_id,
              gateway_signature: response.razorpay_signature,
            });
            showToast(
              "success",
              `Payment verified! Receipt #${verified.receipt_number ?? verified.id}`
            );
            await loadData();
          } catch (err) {
            showToast("error", extractApiError(err));
          } finally {
            setVerifying(false);
          }
        },
        modal: {
          ondismiss: async () => {
            try {
              await markRentPaymentFailed({
                payment_id: order.payment_id,
                gateway_order_id: order.gateway_order_id,
                reason: "Checkout closed before payment completion.",
              });
              await loadData();
            } catch {
              // ignore cleanup errors
            }
          },
        },
      });

      if (rzp.on) {
        rzp.on("payment.failed", async (resp) => {
          try {
            await markRentPaymentFailed({
              payment_id: order.payment_id,
              gateway_order_id: order.gateway_order_id,
              reason: resp.error?.description ?? "Razorpay payment failed.",
            });
            await loadData();
          } catch {
            // ignore
          }
        });
      }

      rzp.open();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setCreatingOrder(false);
    }
  }

  async function handleOpenReceipt(paymentId: number) {
    try {
      const detail = await fetchReceiptDetail(paymentId);
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
      await downloadReceiptPdf(paymentId, receiptNumber);
      showToast("success", "PDF receipt downloaded.");
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setDownloadingPdf(false);
    }
  }

  if (loading && !summary) {
    return <DashboardSkeleton />;
  }

  if (error || !summary) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6 text-rose-500" />}
        title="Unable to load rent ledger"
        description={error ?? "Please try again in a moment."}
        action={<Button onClick={loadData}>Retry</Button>}
      />
    );
  }

  const rent = summary.current_rent;
  const balanceDue = rent ? parseFloat(rent.balance_due) : 0;
  const isOverdue = rent?.status === "overdue";
  const allBills = [
    ...(rent ? [rent] : []),
    ...summary.previous_bills.filter((bill) => bill.id !== rent?.id),
  ];

  const billColumns: ColumnDef<RentRecord>[] = [
    {
      key: "period",
      header: "Period",
      render: (bill) => (
        <div className="whitespace-nowrap">
          <p className="font-semibold text-slate-900">
            {monthName(bill.billing_month)} {bill.billing_year}
          </p>
          <p className="text-[11px] text-slate-400">Due {formatDate(bill.due_date)}</p>
        </div>
      ),
    },
    {
      key: "room",
      header: "Room / Bed",
      render: (bill) => (
        <span className="text-xs text-slate-600 whitespace-nowrap">
          {bill.room_number} · {bill.bed_code}
        </span>
      ),
    },
    {
      key: "breakdown",
      header: "Rent + Food + Other",
      render: (bill) => (
        <span className="text-xs text-slate-600 whitespace-nowrap">
          {formatINR(bill.base_rent)} + {formatINR(bill.food_charges)}
          {parseFloat(bill.other_charges) > 0
            ? ` + ${formatINR(bill.other_charges)}`
            : ""}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (bill) => (
        <span className="font-semibold text-slate-900">{formatINR(bill.total_amount)}</span>
      ),
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      render: (bill) => (
        <span className="font-semibold text-emerald-700">
          {formatINR(bill.amount_paid)}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (bill) => (
        <span className="font-semibold text-brand-700">
          {formatINR(bill.balance_due)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (bill) => <RentStatusBadge status={bill.status} />,
    },
  ];

  const paymentColumns: ColumnDef<PaymentItem>[] = [
    {
      key: "receipt",
      header: "Receipt",
      render: (item) => (
        <span className="font-mono text-xs font-medium text-slate-900">
          {item.receipt_number ?? `PAY-${item.id}`}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (item) => (
        <span className="text-xs text-slate-600">
          {formatDateTime(item.paid_at ?? item.created_at)}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      render: (item) => (
        <span className="text-xs uppercase text-slate-700">
          {item.payment_method.replace("_", " ")}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (item) => (
        <span className="font-semibold text-slate-900">{formatINR(item.amount)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item) => <PaymentStatusBadge status={item.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (item) =>
        item.status === "verified_paid" ? (
          <div className="inline-flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleOpenReceipt(item.id)}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>View</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={downloadingPdf}
              onClick={() =>
                handleDownloadReceipt(
                  item.id,
                  item.receipt_number ?? `receipt-${item.id}`
                )
              }
            >
              <Download className="h-3.5 w-3.5" />
              <span>PDF</span>
            </Button>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">
            {item.notes ?? "No receipt"}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: summary.pg_name },
          { label: "Resident Portal", to: "/tenant" },
          { label: "Rent & Receipts" },
        ]}
        title="My Rent, Receipts & Security Deposit"
        subtitle={`Room ${summary.room_number} · Bed ${summary.bed_code} · ${
          rent
            ? `Latest Bill: ${monthName(rent.billing_month)} ${rent.billing_year} (Due ${formatDate(rent.due_date)})`
            : "No monthly bills generated yet"
        }`}
        badge={
          rent ? (
            <div className="flex items-center gap-2">
              <RentStatusBadge status={rent.status} />
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-800">
                Due {formatINR(rent.balance_due)}
              </span>
            </div>
          ) : undefined
        }
        actions={
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
        }
      />

      {isOverdue && balanceDue > 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>
            Rent payment is overdue since {formatDate(rent?.due_date)}. Please settle your balance to keep your resident ledger up to date.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title={
                rent
                  ? `${monthName(rent.billing_month)} ${rent.billing_year} Rent Breakdown`
                  : "Current Monthly Bill"
              }
              subtitle={
                rent
                  ? `Room ${rent.room_number} · Bed ${rent.bed_code} · Due ${formatDate(rent.due_date)}`
                  : "Waiting for monthly rent generation by PG management"
              }
              action={rent ? <RentStatusBadge status={rent.status} /> : undefined}
            />
            <CardBody className="space-y-5">
              {!rent ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title="No rent record generated yet"
                  description="Once the PG owner or manager generates the bill for your eligible stay month, your breakdown and payment options will appear here."
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                      <p className="text-[11px] font-medium text-slate-500">Room Rent</p>
                      <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
                        {formatINR(rent.base_rent)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                      <p className="text-[11px] font-medium text-slate-500">Food Charges</p>
                      <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
                        {formatINR(rent.food_charges)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                      <p className="text-[11px] font-medium text-slate-500">Other Charges</p>
                      <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
                        {formatINR(rent.other_charges)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-3">
                      <p className="text-[11px] font-medium text-emerald-700">Paid So Far</p>
                      <p className="mt-1 text-base font-bold tabular-nums text-emerald-700">
                        {formatINR(rent.amount_paid)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-brand-200/70 bg-brand-50/60 p-3">
                      <p className="text-[11px] font-medium text-brand-700">Balance Due</p>
                      <p className="mt-1 text-base font-bold tabular-nums text-brand-700">
                        {formatINR(rent.balance_due)}
                      </p>
                    </div>
                  </div>

                  {rent.other_charges_note ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">Other Charges Note: </span>
                      {rent.other_charges_note}
                    </div>
                  ) : null}

                  {balanceDue <= 0 ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        <div>
                          <p className="font-semibold">This bill is fully paid</p>
                          <p className="text-xs text-emerald-700">
                            Download your verified PDF receipt from Payment History below.
                          </p>
                        </div>
                      </div>
                      <Badge tone="success">Settled</Badge>
                    </div>
                  ) : !summary.razorpay_enabled ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        <div className="text-xs text-amber-900">
                          <p className="font-semibold">
                            Online Payment Gateway Not Configured
                          </p>
                          <p className="mt-1 leading-relaxed text-amber-800">
                            Razorpay credentials (<code>RAZORPAY_KEY_ID</code> /{" "}
                            <code>RAZORPAY_KEY_SECRET</code>) are not configured on the
                            backend, so online checkout is disabled. Please pay via Cash,
                            Bank Transfer, or direct UPI and ask your PG Manager or Owner to
                            record the offline payment for an official PDF receipt.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {ONLINE_METHODS.map((method) => {
                          const Icon = method.icon;
                          const active = selectedMethod === method.id;
                          return (
                            <button
                              key={method.id}
                              type="button"
                              onClick={() => setSelectedMethod(method.id)}
                              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                                active
                                  ? "border-navy-900 bg-slate-50 ring-2 ring-navy-900/10"
                                  : "border-slate-200 bg-white hover:border-slate-300"
                              }`}
                            >
                              <div
                                className={`rounded-lg p-2 ${
                                  active
                                    ? "bg-navy-900 text-white"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                <Icon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-900">
                                  {method.label}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {method.subtitle}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel
                            htmlFor="online-pay-amount"
                            label="Amount to Pay (INR)"
                            hint={`Max ${formatINR(rent.balance_due)}`}
                          />
                          <Input
                            id="online-pay-amount"
                            type="number"
                            min="1"
                            max={rent.balance_due}
                            step="0.01"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                          />
                        </div>
                        <Button
                          onClick={handleStartPayment}
                          loading={creatingOrder || verifying}
                          className="h-9 w-full"
                        >
                          <Wallet className="h-4 w-4" />
                          <span>Pay {formatINR(payAmount || rent.balance_due)} Online</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Monthly Billing Records"
              subtitle="Historical rent statements preserve your room, food & charge terms at billing time"
            />
            <DataTable
              columns={billColumns}
              data={allBills}
              rowKey={(bill) => bill.id}
              emptyState={
                <div className="p-5">
                  <EmptyState
                    icon={<FileText className="h-5 w-5" />}
                    title="No billing history yet"
                    description="Your monthly bills will appear here as soon as they are generated."
                  />
                </div>
              }
            />
          </Card>

          <Card>
            <CardHeader
              title="Payment History & Receipts"
              subtitle="Download verified PDF rent receipts for online and offline payments"
            />
            <DataTable
              columns={paymentColumns}
              data={summary.payment_history}
              rowKey={(item) => item.id}
              emptyState={
                <div className="p-5">
                  <EmptyState
                    icon={<Wallet className="h-5 w-5" />}
                    title="No payments recorded yet"
                    description="Your verified rent payments and official PDF receipts will appear here."
                  />
                </div>
              }
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Security Deposit Ledger"
              subtitle="Accounted separately from monthly rent revenue"
              action={<DepositStatusBadge status={summary.security_deposit.paid_status} />}
            />
            <CardBody className="space-y-4">
              <div className="rounded-xl bg-slate-50/80 p-4 ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Deposit Held</span>
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                  {formatINR(summary.security_deposit.amount_held)}
                </p>
                <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Deductions</span>
                    <span className="font-medium tabular-nums text-rose-700">
                      -{formatINR(summary.security_deposit.deduction_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Refunded</span>
                    <span className="font-medium tabular-nums text-slate-900">
                      -{formatINR(summary.security_deposit.refund_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
                    <span className="text-slate-900">Refundable Balance</span>
                    <span className="tabular-nums text-emerald-700">
                      {formatINR(summary.security_deposit.refundable_balance)}
                    </span>
                  </div>
                </div>
                {summary.security_deposit.deduction_reason ? (
                  <p className="mt-2 rounded-lg bg-white p-2 text-[11px] text-slate-600">
                    Deduction Note: {summary.security_deposit.deduction_reason}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-900">
                  Deposit Transaction Log
                </p>
                {summary.security_deposit.transactions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No deposit movements recorded yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {summary.security_deposit.transactions.map((txn) => (
                      <div
                        key={txn.id}
                        className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between font-medium text-slate-900">
                          <span className="capitalize">
                            {txn.transaction_type.replace("_", " ")}
                          </span>
                          <span className="tabular-nums">{formatINR(txn.amount)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-500">
                          <span>{formatDate(txn.transaction_date)}</span>
                          {txn.reference_id ? (
                            <span className="font-mono">{txn.reference_id}</span>
                          ) : null}
                        </div>
                        {txn.reason ? (
                          <p className="mt-1 text-[11px] text-slate-600">{txn.reason}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

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
