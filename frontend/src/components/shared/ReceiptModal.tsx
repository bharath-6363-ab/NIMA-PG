import { Download, MessageCircle, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime, formatINR } from "@/lib/utils";
import { ReceiptDetail } from "@/types/api";

interface ReceiptModalProps {
  open: boolean;
  onClose: () => void;
  receipt: ReceiptDetail | null;
  onDownloadPdf: () => void;
  downloading?: boolean;
}

export function ReceiptModal({
  open,
  onClose,
  receipt,
  onDownloadPdf,
  downloading,
}: ReceiptModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rent Payment Receipt"
      subtitle={receipt ? `Receipt #${receipt.receipt_number}` : undefined}
    >
      {receipt ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-navy-900 p-4 text-white">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-emerald-300 ring-1 ring-white/15">
                <Receipt className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{receipt.pg_name}</p>
                <p className="truncate text-xs text-slate-300">{receipt.pg_address}</p>
              </div>
            </div>
            <Badge tone="success" dot>
              {receipt.payment_status.replace("_", " ").toUpperCase()}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-xs">
            <div>
              <dt className="text-slate-500">Tenant Name</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{receipt.tenant_name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Room / Bed</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                Room {receipt.room_number} · Bed {receipt.bed_code}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Billing Period</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{receipt.billing_period}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Payment Date</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {formatDateTime(receipt.paid_at)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Monthly Rent</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                {formatINR(receipt.base_rent)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Food Charges</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                {formatINR(receipt.food_charges)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Other Authorized Charges</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                {formatINR(receipt.other_charges)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Remaining Balance</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                {formatINR(receipt.remaining_balance)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Payment Method</dt>
              <dd className="mt-0.5 font-semibold uppercase text-slate-900">
                {receipt.payment_method.replace("_", " ")}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Transaction Ref</dt>
              <dd className="mt-0.5 truncate font-mono text-[11px] text-slate-700">
                {receipt.gateway_payment_id ?? "Verified"}
              </dd>
            </div>
          </dl>

          <div className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3">
            <span className="text-sm font-medium text-slate-800">Total Amount Paid</span>
            <span className="text-lg font-bold tabular-nums text-emerald-700">
              {formatINR(receipt.amount_paid)}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={onDownloadPdf} loading={downloading} className="flex-1">
              <Download className="h-4 w-4" />
              <span>Download PDF Receipt</span>
            </Button>
            <a
              href={receipt.whatsapp_share_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <MessageCircle className="h-4 w-4" />
              <span>Share on WhatsApp</span>
            </a>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
