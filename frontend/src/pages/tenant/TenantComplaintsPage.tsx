import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  FilePlus2,
  ImagePlus,
  MessageSquareWarning,
  RefreshCw,
  Star,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { AuthImage } from "@/components/shared/AuthImage";
import { EmptyState, LoadingState } from "@/components/shared/StateHelpers";
import {
  COMPLAINT_CATEGORY_LABELS,
  ComplaintCategoryBadge,
  ComplaintStatusBadge,
} from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDateTime } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  fetchComplaintDetail,
  fetchTenantComplaintSummary,
  rateResolvedComplaint,
  submitTenantComplaint,
} from "@/services/complaintService";
import {
  ComplaintCategory,
  ComplaintItem,
  TenantComplaintSummary,
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

const WORKFLOW_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "viewed_by_manager", label: "Viewed by Manager" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
] as const;

export function TenantComplaintsPage() {
  const { showToast } = useToast();
  const [summary, setSummary] = useState<TenantComplaintSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Submit complaint modal
  const [submitOpen, setSubmitOpen] = useState(false);
  const [category, setCategory] = useState<ComplaintCategory>("plumbing");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Detail modal
  const [selectedComplaint, setSelectedComplaint] = useState<ComplaintItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Rating form inside detail modal
  const [ratingValue, setRatingValue] = useState<number>(5);
  const [ratingFeedback, setRatingFeedback] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTenantComplaintSummary();
      setSummary(data);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function handleSubmitComplaint(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) {
      showToast("error", "Title must be at least 3 characters.");
      return;
    }
    if (description.trim().length < 5) {
      showToast("error", "Please enter at least 5 characters describing the issue.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await submitTenantComplaint({
        category,
        title: title.trim(),
        description: description.trim(),
        image: imageFile,
      });
      showToast(
        "success",
        "Complaint submitted",
        `Ticket #${created.id} has been sent to your PG Manager.`
      );
      setSubmitOpen(false);
      setTitle("");
      setDescription("");
      setImageFile(null);
      await loadSummary();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenDetail(item: ComplaintItem) {
    setSelectedComplaint(item);
    setRatingValue(item.tenant_rating ?? 5);
    setRatingFeedback(item.tenant_feedback ?? "");
    setLoadingDetail(true);
    try {
      const fresh = await fetchComplaintDetail(item.id);
      setSelectedComplaint(fresh);
      setRatingValue(fresh.tenant_rating ?? 5);
      setRatingFeedback(fresh.tenant_feedback ?? "");
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleSubmitRating(e: FormEvent) {
    e.preventDefault();
    if (!selectedComplaint) return;
    setSubmittingRating(true);
    try {
      const updated = await rateResolvedComplaint(selectedComplaint.id, {
        rating: ratingValue,
        feedback: ratingFeedback.trim() || undefined,
      });
      setSelectedComplaint(updated);
      showToast("success", "Thank you for rating the resolution.");
      await loadSummary();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSubmittingRating(false);
    }
  }

  function stepCompleted(item: ComplaintItem, stepKey: string): boolean {
    const order = ["submitted", "viewed_by_manager", "in_progress", "resolved"];
    return order.indexOf(item.status) >= order.indexOf(stepKey);
  }

  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <StatGridSkeleton count={4} />
        <TableSkeleton rows={4} />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
        title="Unable to load complaints"
        description={error ?? "Please try again in a moment."}
        action={<Button onClick={loadSummary}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Resident Portal", to: "/tenant" },
          { label: "Complaints" },
        ]}
        title="My Complaints & Maintenance"
        subtitle="Raise room or facility issues with optional photos, track manager updates in real time, and rate resolved tickets."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={loadSummary}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
            <Button size="sm" onClick={() => setSubmitOpen(true)}>
              <FilePlus2 className="h-4 w-4" />
              <span>Submit New Complaint</span>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Complaints"
          value={summary.total_count}
          icon={MessageSquareWarning}
          tone="navy"
        />
        <StatCard
          label="Open (Submitted / Viewed)"
          value={summary.open_count}
          icon={Clock}
          tone="amber"
        />
        <StatCard
          label="In Progress"
          value={summary.in_progress_count}
          icon={Wrench}
          tone="blue"
        />
        <StatCard
          label="Resolved"
          value={summary.resolved_count}
          icon={CheckCircle2}
          tone="emerald"
        />
      </div>

      <Card>
        <CardHeader
          title="Complaint History"
          subtitle="Click any ticket to inspect the workflow timeline, manager remarks, and resolution rating"
        />
        <CardBody>
          {summary.complaints.length === 0 ? (
            <EmptyState
              icon={<MessageSquareWarning className="h-5 w-5" />}
              title="No complaints raised yet"
              description="Need something repaired in your room or shared area? Submit a complaint anytime."
              action={
                <Button size="sm" onClick={() => setSubmitOpen(true)}>
                  <FilePlus2 className="h-4 w-4" />
                  <span>Submit New Complaint</span>
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {summary.complaints.map((c) => (
                <Card
                  key={c.id}
                  interactive
                  onClick={() => void handleOpenDetail(c)}
                  className="cursor-pointer p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-400">#{c.id}</span>
                        <ComplaintCategoryBadge category={c.category} />
                        <ComplaintStatusBadge status={c.status} />
                        {c.images.length > 0 ? (
                          <Badge tone="neutral">Photo attached</Badge>
                        ) : null}
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">{c.title}</h3>
                      <p className="line-clamp-2 text-xs text-slate-600">{c.description}</p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 text-right text-[11px] text-slate-500">
                      <span>Submitted {formatDateTime(c.submitted_at)}</span>
                      <span>
                        Room {c.room_number} · Bed {c.bed_code}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleOpenDetail(c);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Track Progress</span>
                      </Button>
                    </div>
                  </div>

                  {c.manager_remarks ? (
                    <div className="mt-3 rounded-xl border border-brand-200/70 bg-brand-50/50 px-3 py-2 text-xs text-slate-800">
                      <span className="font-semibold">Manager Remarks: </span>
                      {c.manager_remarks}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Submit Complaint Modal */}
      <Modal
        open={submitOpen}
        onClose={() => !submitting && setSubmitOpen(false)}
        title="Submit Maintenance Complaint"
        subtitle="Your room & bed details are attached automatically from your verified account."
      >
        <form onSubmit={handleSubmitComplaint} className="space-y-4">
          <div>
            <FieldLabel htmlFor="cmp-category" label="Issue Category" required />
            <Select
              id="cmp-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {COMPLAINT_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <FieldLabel
              htmlFor="cmp-title"
              label="Complaint Title"
              required
              hint="Min 3 characters"
            />
            <Input
              id="cmp-title"
              placeholder="e.g., Washbasin tap leaking or AC cooling low"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
            />
          </div>

          <div>
            <FieldLabel
              htmlFor="cmp-desc"
              label="Detailed Description"
              required
              hint="Min 5 characters"
            />
            <Textarea
              id="cmp-desc"
              placeholder="Describe what is happening and since when..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              required
            />
          </div>

          <div>
            <FieldLabel
              htmlFor="cmp-photo"
              label="Attach Photo (Optional)"
              hint="JPG, PNG, or WEBP (max 5 MB)"
            />
            <label
              htmlFor="cmp-photo"
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
            >
              <ImagePlus className="h-4 w-4 text-brand-600" />
              <span>
                {imageFile ? imageFile.name : "Choose an image showing the issue"}
              </span>
              <input
                id="cmp-photo"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSubmitOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit Complaint
            </Button>
          </div>
        </form>
      </Modal>

      {/* Complaint Details & Timeline Modal */}
      <Modal
        open={Boolean(selectedComplaint)}
        onClose={() => setSelectedComplaint(null)}
        title={
          selectedComplaint
            ? `Complaint #${selectedComplaint.id} — ${selectedComplaint.title}`
            : "Complaint Details"
        }
        subtitle={
          selectedComplaint
            ? `Room ${selectedComplaint.room_number} · Bed ${selectedComplaint.bed_code} · Submitted ${formatDateTime(selectedComplaint.submitted_at)}`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {loadingDetail ? (
          <LoadingState label="Refreshing latest status..." />
        ) : selectedComplaint ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ComplaintCategoryBadge category={selectedComplaint.category} />
              <ComplaintStatusBadge status={selectedComplaint.status} />
              {selectedComplaint.assigned_manager_name ? (
                <span className="text-xs text-slate-500">
                  Handled by{" "}
                  <strong className="text-slate-900">
                    {selectedComplaint.assigned_manager_name}
                  </strong>
                </span>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-700">
              {selectedComplaint.description}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Resolution Workflow Progress
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WORKFLOW_STEPS.map((step) => {
                  const done = stepCompleted(selectedComplaint, step.key);
                  return (
                    <div
                      key={step.key}
                      className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs ${
                        done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-slate-200 bg-white text-slate-400"
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <Clock className="h-4 w-4 shrink-0 text-slate-300" />
                      )}
                      <span className="font-medium">{step.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {selectedComplaint.images.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attached Photos
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {selectedComplaint.images.map((img) => (
                    <div
                      key={img.id}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 p-2"
                    >
                      <AuthImage
                        src={img.url}
                        alt={img.file_name}
                        className="h-48 w-full rounded-lg object-cover"
                      />
                      <p className="mt-1.5 truncate text-[11px] text-slate-500">
                        {img.file_name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Status Change History
              </p>
              <div className="space-y-2">
                {selectedComplaint.history.map((h) => (
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

            {selectedComplaint.status === "resolved" ? (
              <div className="rounded-xl border border-brand-200/80 bg-brand-50/50 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Wrench className="h-4 w-4 text-brand-600" />
                  <span>Rate Maintenance Resolution</span>
                </div>
                <form onSubmit={handleSubmitRating} className="space-y-3">
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRatingValue(star)}
                        className="rounded p-1 transition-transform hover:scale-110"
                        aria-label={`Rate ${star} stars`}
                      >
                        <Star
                          className={`h-5 w-5 ${
                            star <= ratingValue
                              ? "fill-amber-400 text-amber-400"
                              : "text-slate-300"
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-2 text-xs font-medium text-slate-900">
                      {ratingValue} / 5
                    </span>
                  </div>
                  <Textarea
                    placeholder="Optional feedback about the repair quality or speed..."
                    value={ratingFeedback}
                    onChange={(e) => setRatingFeedback(e.target.value)}
                  />
                  <Button type="submit" size="sm" loading={submittingRating}>
                    {selectedComplaint.tenant_rating ? "Update Rating" : "Submit Rating"}
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
