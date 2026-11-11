import { Badge, BadgeTone } from "@/components/ui/Badge";
import {
  BedStatus,
  ComplaintCategory,
  ComplaintStatus,
  DepositStatus,
  PaymentStatus,
  RentStatus,
  TenantStatus,
} from "@/types/api";

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  ac: "AC",
  wifi: "WiFi",
  water: "Water",
  cleaning: "Cleaning",
  electrical_maintenance: "Electrical Maintenance",
  door_lock: "Door Lock",
  plumbing: "Plumbing",
  other: "Other",
};

export function ComplaintCategoryBadge({ category }: { category: ComplaintCategory }) {
  return <Badge tone="info">{COMPLAINT_CATEGORY_LABELS[category] ?? category}</Badge>;
}

export function RentStatusBadge({ status }: { status: RentStatus }) {
  const map: Record<RentStatus, { tone: BadgeTone; label: string }> = {
    paid: { tone: "success", label: "Paid" },
    partial: { tone: "info", label: "Partial" },
    pending: { tone: "warning", label: "Pending" },
    overdue: { tone: "error", label: "Overdue" },
  };
  const item = map[status];
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { tone: BadgeTone; label: string }> = {
    verified_paid: { tone: "success", label: "Verified Paid" },
    created: { tone: "neutral", label: "Initiated" },
    pending: { tone: "warning", label: "Pending" },
    failed: { tone: "error", label: "Failed" },
    refunded: { tone: "info", label: "Refunded" },
  };
  const item = map[status] ?? { tone: "neutral" as BadgeTone, label: status };
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  );
}

export function DepositStatusBadge({ status }: { status: DepositStatus }) {
  const map: Record<DepositStatus, { tone: BadgeTone; label: string }> = {
    held: { tone: "success", label: "Held" },
    pending: { tone: "warning", label: "Pending" },
    partially_refunded: { tone: "info", label: "Partially Refunded" },
    refunded: { tone: "neutral", label: "Refunded" },
  };
  const item = map[status];
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  );
}

export function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
  const map: Record<ComplaintStatus, { tone: BadgeTone; label: string }> = {
    submitted: { tone: "info", label: "Submitted" },
    viewed_by_manager: { tone: "warning", label: "Viewed" },
    in_progress: { tone: "warning", label: "In Progress" },
    resolved: { tone: "success", label: "Resolved" },
  };
  const item = map[status];
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  );
}

export function BedStatusBadge({ status }: { status: BedStatus }) {
  const map: Record<BedStatus, { tone: BadgeTone; label: string }> = {
    vacant: { tone: "success", label: "Vacant" },
    occupied: { tone: "neutral", label: "Occupied" },
    notice_period: { tone: "warning", label: "Notice Period" },
    maintenance: { tone: "error", label: "Maintenance" },
  };
  const item = map[status];
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  );
}

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const map: Record<TenantStatus, { tone: BadgeTone; label: string }> = {
    active: { tone: "success", label: "Active" },
    notice_period: { tone: "warning", label: "Notice Period" },
    checked_out: { tone: "neutral", label: "Checked Out" },
  };
  const item = map[status];
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  );
}
