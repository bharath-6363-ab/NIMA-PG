import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpDown,
  CheckCircle2,
  Eye,
  MessageSquareWarning,
  RefreshCw,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, SearchInput, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { AuthImage } from "@/components/shared/AuthImage";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState, LoadingState } from "@/components/shared/StateHelpers";
import {
  COMPLAINT_CATEGORY_LABELS,
  ComplaintCategoryBadge,
  ComplaintStatusBadge,
} from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { cn, formatDateTime } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  fetchComplaintDetail,
  fetchManagerComplaints,
  updateManagerComplaintStatus,
} from "@/services/complaintService";
import {
  ComplaintCategory,
  ComplaintItem,
  ComplaintStatus,
  ManagerComplaintSummary,
} from "@/types/api";

const CATEGORIES: ComplaintCategory[] = [
  "ac",
  "wifi",
  "water",
  "cleaning",
  "electrical_maintenance",
  "door_lock",
  "plumbing",
  "other",
];

const MANAGER_NEXT_STATUSES: { value: ComplaintStatus; label: string }[] = [
  { value: "viewed_by_manager", label: "Viewed by Manager" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
];

export function ComplaintManagementPage() {
  const { showToast } = useToast();
  const [summary, setSummary] = useState<ManagerComplaintSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ComplaintCategory | "">("");
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | "">("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // Detail & status modal
  const [activeComplaint, setActiveComplaint] = useState<ComplaintItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [nextStatus, setNextStatus] = useState<ComplaintStatus>("viewed_by_manager");
  const [remarks, setRemarks] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const loadComplaints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManagerComplaints({
        search: searchQuery,
        category: categoryFilter,
        status: statusFilter,
        sort_order: sortOrder,
      });
      setSummary(data);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter, statusFilter, sortOrder]);

  useEffect(() => {
    void loadComplaints();
  }, [loadComplaints]);

  async function openComplaintModal(item: ComplaintItem) {
    setActiveComplaint(item);
    setNextStatus(item.status === "submitted" ? "viewed_by_manager" : item.status);
    setRemarks(item.manager_remarks ?? "");
    setLoadingDetail(true);
    try {
      const fresh = await fetchComplaintDetail(item.id);
      setActiveComplaint(fresh);
      setNextStatus(fresh.status === "submitted" ? "viewed_by_manager" : fresh.status);
      setRemarks(fresh.manager_remarks ?? "");
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleRequestStatusUpdate(e: FormEvent) {
    e.preventDefault();
    if (!activeComplaint) return;
    setConfirmOpen(true);
  }

  async function handleConfirmStatusUpdate() {
    if (!activeComplaint) return;
    setUpdating(true);
    try {
      const updated = await updateManagerComplaintStatus(activeComplaint.id, {
        status: nextStatus,
        remarks: remarks.trim() || undefined,
      });
      setActiveComplaint(updated);
      setConfirmOpen(false);
      showToast(
        "success",
        "Complaint status updated",
        `Ticket #${updated.id} marked as ${updated.status.replace(/_/g, " ")}.`
      );
      await loadComplaints();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setUpdating(false);
    }
  }

  const complaints = summary?.complaints ?? [];

  const columns: ColumnDef<ComplaintItem>[] = [
    {
      key: "issue",
      header: "Ticket / Issue",
      render: (c) => (
        <div className="max-w-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
            <span className="font-mono text-xs text-slate-400">#{c.id}</span>
            <span>{c.title}</span>
            {c.images.length > 0 ? <Badge tone="neutral">Photo</Badge> : null}
          </div>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
            {c.manager_remarks ?? c.description}
          </p>
        </div>
      ),
    },
    {
      key: "resident",
      header: "Resident & Room",
      render: (c) => (
        <div className="whitespace-nowrap">
          <p className="font-medium text-slate-900">{c.tenant_name}</p>
          <p className="text-[11px] text-slate-500">
            Room {c.room_number} · {c.bed_code}
          </p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (c) => <ComplaintCategoryBadge category={c.category} />,
    },
    {
      key: "submitted",
      header: "Submitted",
      render: (c) => (
        <span className="text-xs text-slate-600 whitespace-nowrap">
          {formatDateTime(c.submitted_at)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <ComplaintStatusBadge status={c.status} />,
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (c) => (
        <Button
          size="sm"
          variant={c.status === "submitted" ? "primary" : "outline"}
          onClick={() => void openComplaintModal(c)}
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Inspect &amp; Update</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Services" }, { label: "Complaints" }]}
        title="Complaint & Maintenance Operations"
        subtitle="Review resident tickets, inspect uploaded photos, and update status transitions with full audit trails."
        actions={
          <Button variant="outline" size="sm" onClick={loadComplaints}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
        }
      />

      {loading && !summary ? (
        <>
          <StatGridSkeleton count={4} />
          <TableSkeleton rows={6} />
        </>
      ) : (
        <>
          {summary ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setStatusFilter("")}
                className={cn(
                  "rounded-xl border bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover",
                  statusFilter === ""
                    ? "border-navy-900 ring-2 ring-navy-900/10"
                    : "border-slate-200/85"
                )}
              >
                <p className="text-xs font-medium text-slate-500">All PG Complaints</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
                  {summary.total_count ??
                    summary.new_count + summary.in_progress_count + summary.resolved_count}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("submitted")}
                className={cn(
                  "rounded-xl border bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover",
                  statusFilter === "submitted"
                    ? "border-rose-500 ring-2 ring-rose-500/15"
                    : "border-slate-200/85"
                )}
              >
                <p className="text-xs font-medium text-rose-700">New / Unopened</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-rose-700">
                  {Math.max(0, summary.new_count - (summary.viewed_count ?? 0))}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("in_progress")}
                className={cn(
                  "rounded-xl border bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover",
                  statusFilter === "in_progress"
                    ? "border-amber-500 ring-2 ring-amber-500/15"
                    : "border-slate-200/85"
                )}
              >
                <p className="text-xs font-medium text-amber-800">In Progress</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-amber-700">
                  {summary.in_progress_count}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("resolved")}
                className={cn(
                  "rounded-xl border bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover",
                  statusFilter === "resolved"
                    ? "border-emerald-500 ring-2 ring-emerald-500/15"
                    : "border-slate-200/85"
                )}
              >
                <p className="text-xs font-medium text-emerald-700">Resolved</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-emerald-700">
                  {summary.resolved_count}
                </p>
              </button>
            </div>
          ) : null}

          <Card>
            <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <FieldLabel htmlFor="mgr-cmp-search" label="Search Tenant / Room" />
                <SearchInput
                  id="mgr-cmp-search"
                  placeholder="Name, room, title..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              </div>

              <div>
                <FieldLabel htmlFor="mgr-cmp-cat" label="Category" />
                <Select
                  id="mgr-cmp-cat"
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value as ComplaintCategory | "")
                  }
                >
                  <option value="">All Categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {COMPLAINT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <FieldLabel htmlFor="mgr-cmp-status" label="Status" />
                <Select
                  id="mgr-cmp-status"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as ComplaintStatus | "")
                  }
                >
                  <option value="">All Statuses</option>
                  <option value="submitted">Submitted (New)</option>
                  <option value="viewed_by_manager">Viewed by Manager</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                </Select>
              </div>

              <div>
                <FieldLabel htmlFor="mgr-cmp-sort" label="Sort Order" />
                <Select
                  id="mgr-cmp-sort"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as "desc" | "asc")}
                >
                  <option value="desc">Newest First</option>
                  <option value="asc">Oldest First</option>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("");
                    setStatusFilter("");
                    setSortOrder("desc");
                  }}
                >
                  <ArrowUpDown className="h-4 w-4" />
                  <span>Reset Filters</span>
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Complaint Queue"
              subtitle={`${complaints.length} ticket${complaints.length === 1 ? "" : "s"} shown`}
            />
            {loading ? (
              <CardBody>
                <TableSkeleton rows={5} />
              </CardBody>
            ) : error ? (
              <CardBody>
                <EmptyState
                  icon={<AlertCircle className="h-5 w-5 text-rose-500" />}
                  title="Could not load complaints"
                  description={error}
                  action={<Button onClick={loadComplaints}>Retry</Button>}
                />
              </CardBody>
            ) : (
              <DataTable
                columns={columns}
                data={complaints}
                rowKey={(c) => c.id}
                emptyState={
                  <div className="p-5">
                    <EmptyState
                      icon={<MessageSquareWarning className="h-5 w-5" />}
                      title="No matching complaints"
                      description="Adjust your search, status, or category filter to view other complaints."
                    />
                  </div>
                }
              />
            )}
          </Card>
        </>
      )}

      {/* Manager Complaint Details & Status Update Modal */}
      <Modal
        open={Boolean(activeComplaint)}
        onClose={() => !updating && setActiveComplaint(null)}
        title={
          activeComplaint
            ? `Manage Complaint #${activeComplaint.id} — ${activeComplaint.title}`
            : "Complaint Details"
        }
        subtitle={
          activeComplaint
            ? `${activeComplaint.tenant_name} · Room ${activeComplaint.room_number} (${activeComplaint.bed_code})`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {loadingDetail ? (
          <LoadingState label="Loading complaint details..." />
        ) : activeComplaint ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ComplaintCategoryBadge category={activeComplaint.category} />
              <ComplaintStatusBadge status={activeComplaint.status} />
              <span className="text-xs text-slate-500">
                Submitted {formatDateTime(activeComplaint.submitted_at)}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-700">
              {activeComplaint.description}
            </div>

            {activeComplaint.images.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tenant Photo Attachment
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {activeComplaint.images.map((img) => (
                    <div
                      key={img.id}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 p-2"
                    >
                      <AuthImage
                        src={img.url}
                        alt={img.file_name}
                        className="h-48 w-full rounded-lg object-cover"
                      />
                      <p className="mt-1 truncate text-[11px] text-slate-500">
                        {img.file_name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <form
              onSubmit={handleRequestStatusUpdate}
              className="space-y-3 rounded-xl border border-brand-200/80 bg-brand-50/40 p-4"
            >
              <p className="text-xs font-semibold text-slate-900">
                Update Workflow Status &amp; Remarks
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="mgr-next-st" label="New Status" required />
                  <Select
                    id="mgr-next-st"
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value as ComplaintStatus)}
                  >
                    {MANAGER_NEXT_STATUSES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="mgr-remarks" label="Manager Remarks" />
                <Textarea
                  id="mgr-remarks"
                  placeholder="Share technician schedule, part ordered, or resolution summary..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  maxLength={1000}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Update Status</span>
                </Button>
              </div>
            </form>

            {activeComplaint.tenant_rating ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-900">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span>Tenant Resolution Rating: {activeComplaint.tenant_rating}/5</span>
                </div>
                {activeComplaint.tenant_feedback ? (
                  <p className="mt-1 text-emerald-800">{activeComplaint.tenant_feedback}</p>
                ) : null}
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Audit History
              </p>
              <div className="space-y-2">
                {activeComplaint.history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold capitalize text-slate-900">
                        {h.new_status.replace(/_/g, " ")}
                        {h.changed_by_name ? (
                          <span className="ml-1.5 font-normal text-slate-500">
                            by {h.changed_by_name}
                          </span>
                        ) : null}
                      </p>
                      {h.remarks ? (
                        <p className="mt-0.5 text-slate-600">{h.remarks}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {formatDateTime(h.changed_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmStatusUpdate}
        title="Confirm Complaint Status Change"
        description={
          activeComplaint
            ? `Update complaint #${activeComplaint.id} to "${nextStatus.replace(/_/g, " ")}" and notify ${activeComplaint.tenant_name}?`
            : ""
        }
        confirmLabel="Confirm Update"
        loading={updating}
      />
    </div>
  );
}
