import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Download,
  Edit3,
  FileText,
  History,
  LogOut,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { AuthImage, downloadProtectedFile } from "@/components/shared/AuthImage";
import { EmptyState } from "@/components/shared/StateHelpers";
import {
  DepositStatusBadge,
  TenantStatusBadge,
} from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  checkoutTenant,
  getTenantDetail,
  updateTenant,
  uploadTenantDocument,
} from "@/services/tenantMgmtService";
import {
  DocumentType,
  PoliceVerificationStatus,
  TenantStatus,
  TenantSummary,
} from "@/types/api";

export function TenantProfilePage() {
  const { tenantId } = useParams();
  const { showToast } = useToast();

  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit Modal
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editRent, setEditRent] = useState("");
  const [editFood, setEditFood] = useState("");
  const [editPolice, setEditPolice] = useState<PoliceVerificationStatus>("pending");
  const [editStatus, setEditStatus] = useState<TenantStatus>("active");
  const [savingEdit, setSavingEdit] = useState(false);

  // Document Upload
  const [docType, setDocType] = useState<DocumentType>("id_proof");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);

  // Checkout Modal
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [leavingDate, setLeavingDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [deductionAmount, setDeductionAmount] = useState("0");
  const [deductionReason, setDeductionReason] = useState("");
  const [checkoutRemarks, setCheckoutRemarks] = useState("");
  const [markMaintenance, setMarkMaintenance] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const loadTenant = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await getTenantDetail(Number(tenantId));
      setTenant(data);
    } catch (err) {
      showToast("error", "Failed to load tenant", extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [showToast, tenantId]);

  useEffect(() => {
    void loadTenant();
  }, [loadTenant]);

  function openEditModal() {
    if (!tenant) return;
    setEditName(tenant.full_name);
    setEditEmail(tenant.email ?? "");
    setEditAddress(tenant.permanent_address ?? "");
    setEditRent(String(parseFloat(tenant.monthly_rent)));
    setEditFood(String(parseFloat(tenant.food_charges)));
    setEditPolice(tenant.police_verification_status);
    setEditStatus(tenant.status);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    setSavingEdit(true);
    try {
      const updated = await updateTenant(tenant.id, {
        full_name: editName,
        email: editEmail.trim() || undefined,
        permanent_address: editAddress.trim() || undefined,
        monthly_rent: editRent,
        food_charges: editFood,
        police_verification_status: editPolice,
        status: editStatus,
      });
      setTenant(updated);
      setEditOpen(false);
      showToast("success", "Profile Updated", "Tenant information saved.");
    } catch (err) {
      showToast("error", "Update Failed", extractApiError(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDocUpload(e: FormEvent) {
    e.preventDefault();
    if (!tenant || !docFile) return;
    setUploadingDoc(true);
    try {
      await uploadTenantDocument(tenant.id, docType, docFile);
      setDocFile(null);
      showToast("success", "Document Uploaded", "Stored privately with tenant record.");
      await loadTenant();
    } catch (err) {
      showToast("error", "Upload Failed", extractApiError(err));
    } finally {
      setUploadingDoc(false);
    }
  }

  async function handleCheckoutSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    setCheckingOut(true);
    try {
      const res = await checkoutTenant(tenant.id, {
        leaving_date: leavingDate,
        deduction_amount: deductionAmount || "0",
        deduction_reason: deductionReason.trim() || undefined,
        checkout_remarks: checkoutRemarks.trim() || undefined,
        mark_bed_maintenance: markMaintenance,
      });
      setTenant(res.tenant);
      setCheckoutOpen(false);
      showToast(
        "success",
        "Checkout Completed",
        `Bed ${res.bed_code} is now ${res.bed_status.toUpperCase()}. Refund: ${formatINR(res.refund_amount)}.`
      );
    } catch (err) {
      showToast("error", "Checkout Failed", extractApiError(err));
    } finally {
      setCheckingOut(false);
    }
  }

  if (loading) return <DashboardSkeleton />;
  if (!tenant) {
    return (
      <EmptyState
        icon={<FileText className="h-6 w-6" />}
        title="Tenant not found"
        description="This tenant profile could not be loaded."
        action={
          <Link to="/tenants">
            <Button>Back to Tenants</Button>
          </Link>
        }
      />
    );
  }

  const heldNum = parseFloat(tenant.security_deposit_amount || "0");
  const deductNum = parseFloat(deductionAmount || "0") || 0;
  const refundPreview = Math.max(0, heldNum - deductNum);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Operations" },
          { label: "Tenants", to: "/tenants" },
          { label: tenant.full_name },
        ]}
        title={tenant.full_name}
        subtitle={`Room ${tenant.room_number} · Bed ${tenant.bed_code} · Joined ${formatDate(
          tenant.joining_date
        )}`}
        badge={<TenantStatusBadge status={tenant.status} />}
        actions={
          <>
            <Link to="/tenants">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                <span>Tenants</span>
              </Button>
            </Link>
            {tenant.status !== "checked_out" ? (
              <>
                <Button variant="outline" size="sm" onClick={openEditModal}>
                  <Edit3 className="h-4 w-4" />
                  <span>Edit Tenant</span>
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDeductionAmount("0");
                    setDeductionReason("");
                    setCheckoutRemarks("");
                    setMarkMaintenance(false);
                    setCheckoutOpen(true);
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  <span>Checkout</span>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Resident & Allocation Details" />
          <CardBody>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">Mobile Number</dt>
                <dd className="mt-0.5 font-mono font-semibold text-slate-900">
                  {tenant.mobile}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">Email</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {tenant.email ?? "—"}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">Room &amp; Bed</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">
                  Room {tenant.room_number} · Bed {tenant.bed_code}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">Monthly Terms</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                  Rent {formatINR(tenant.monthly_rent)} + Food{" "}
                  {formatINR(tenant.food_charges)}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">Emergency Contact</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {tenant.emergency_contact_name} ({tenant.emergency_contact_phone})
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">Police Verification</dt>
                <dd className="mt-1">
                  <Badge
                    tone={
                      tenant.police_verification_status === "verified"
                        ? "success"
                        : "warning"
                    }
                    dot
                    className="capitalize"
                  >
                    {tenant.police_verification_status.replace("_", " ")}
                  </Badge>
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">DOB / Gender</dt>
                <dd className="mt-0.5 capitalize text-slate-900">
                  {tenant.date_of_birth ? formatDate(tenant.date_of_birth) : "—"} ·{" "}
                  {tenant.gender ?? "—"}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-50/80 p-3">
                <dt className="text-xs text-slate-500">
                  {tenant.leaving_date ? "Leaving Date" : "Expected Leaving"}
                </dt>
                <dd className="mt-0.5 text-slate-900">
                  {tenant.leaving_date
                    ? formatDate(tenant.leaving_date)
                    : tenant.expected_leaving_date
                      ? formatDate(tenant.expected_leaving_date)
                      : "Not specified"}
                </dd>
              </div>
              {tenant.permanent_address ? (
                <div className="rounded-xl bg-slate-50/80 p-3 sm:col-span-2">
                  <dt className="text-xs text-slate-500">Permanent Address</dt>
                  <dd className="mt-0.5 text-slate-900">{tenant.permanent_address}</dd>
                </div>
              ) : null}
              {tenant.checkout_remarks ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 sm:col-span-2">
                  <dt className="text-xs font-semibold text-amber-900">
                    Checkout Remarks
                  </dt>
                  <dd className="mt-0.5 text-amber-900">{tenant.checkout_remarks}</dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Security Deposit"
            action={
              tenant.deposit_status ? (
                <DepositStatusBadge status={tenant.deposit_status} />
              ) : null
            }
          />
          <CardBody className="space-y-3 text-sm">
            <div className="rounded-xl bg-navy-900 p-4 text-white">
              <p className="text-xs text-slate-300">Initial Deposit Held</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatINR(tenant.security_deposit_amount)}
              </p>
            </div>
            {tenant.deposit_deduction_amount &&
            parseFloat(tenant.deposit_deduction_amount) > 0 ? (
              <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 p-3 text-xs text-rose-800">
                <p className="font-semibold">
                  Deduction: {formatINR(tenant.deposit_deduction_amount)}
                </p>
                {tenant.deposit_deduction_reason ? (
                  <p className="mt-0.5">{tenant.deposit_deduction_reason}</p>
                ) : null}
              </div>
            ) : null}
            {tenant.status === "checked_out" &&
            tenant.deposit_refund_amount !== null ? (
              <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3 text-xs text-emerald-900">
                <p className="font-semibold">
                  Refundable Settled: {formatINR(tenant.deposit_refund_amount)}
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Uploaded KYC & Agreement Documents"
            subtitle="Access restricted to authorized PG staff & owning tenant"
          />
          <CardBody className="space-y-4">
            {tenant.documents.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No documents uploaded"
                description="Upload government ID proof, photo, or rental agreement below."
              />
            ) : (
              <div className="space-y-2.5">
                {tenant.documents.map((doc) => {
                  const isImg = doc.mime_type.startsWith("image/");
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {isImg ? (
                          <button
                            type="button"
                            onClick={() => setPreviewDocUrl(doc.url)}
                            className="shrink-0 overflow-hidden rounded-lg border border-slate-200"
                          >
                            <AuthImage
                              src={doc.url}
                              alt={doc.file_name}
                              className="h-10 w-10 object-cover"
                            />
                          </button>
                        ) : (
                          <div className="rounded-lg bg-white p-2 text-brand-600 ring-1 ring-slate-200">
                            <FileText className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900">
                            {doc.file_name}
                          </p>
                          <p className="text-[11px] capitalize text-slate-500">
                            {doc.doc_type.replace("_", " ")} · {formatDate(doc.uploaded_at)}
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
                  );
                })}
              </div>
            )}

            <form
              onSubmit={handleDocUpload}
              className="space-y-3 border-t border-slate-100 pt-4"
            >
              <p className="text-xs font-semibold text-slate-900">
                Upload Additional Document
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                >
                  <option value="id_proof">Government ID Proof</option>
                  <option value="photo">Tenant Photo</option>
                  <option value="rental_agreement">Rental Agreement</option>
                  <option value="police_verification">Police Verification</option>
                  <option value="other">Other</option>
                </Select>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700"
                  required
                />
              </div>
              <Button type="submit" size="sm" loading={uploadingDoc} disabled={!docFile}>
                <Upload className="h-3.5 w-3.5" />
                <span>Upload Document</span>
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Tenant Allocation History"
            subtitle="Preserved room, bed, and checkout timeline"
            action={<History className="h-4 w-4 text-slate-400" />}
          />
          <CardBody>
            {tenant.allocation_history.length === 0 ? (
              <EmptyState
                icon={<Calendar className="h-5 w-5" />}
                title="No history entries"
                description="Allocation and checkout events will appear here."
              />
            ) : (
              <div className="space-y-3">
                {tenant.allocation_history.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold uppercase text-brand-700">
                        {h.action.replace("_", " ")}
                      </span>
                      <span className="text-slate-500">
                        {formatDate(h.start_date)}
                        {h.end_date ? ` → ${formatDate(h.end_date)}` : ""}
                      </span>
                    </div>
                    <p className="mt-1 font-medium text-slate-900">
                      Room {h.room_number} · Bed {h.bed_code} (Rent{" "}
                      {formatINR(h.monthly_rent)} + Food {formatINR(h.food_charges)})
                    </p>
                    {h.remarks ? (
                      <p className="mt-0.5 text-slate-600">{h.remarks}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Edit Modal */}
      <Modal
        open={editOpen}
        onClose={() => !savingEdit && setEditOpen(false)}
        title={`Edit Tenant — ${tenant.full_name}`}
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="et-name" label="Full Name" required />
            <Input
              id="et-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="et-email" label="Email" />
              <Input
                id="et-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="et-status" label="Occupancy Status" />
              <Select
                id="et-status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as TenantStatus)}
              >
                <option value="active">Active</option>
                <option value="notice_period">Notice Period</option>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <FieldLabel htmlFor="et-rent" label="Monthly Rent (₹)" />
              <Input
                id="et-rent"
                type="number"
                min={0}
                step="0.01"
                value={editRent}
                onChange={(e) => setEditRent(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="et-food" label="Food Charges (₹)" />
              <Input
                id="et-food"
                type="number"
                min={0}
                step="0.01"
                value={editFood}
                onChange={(e) => setEditFood(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="et-pol" label="Police Verification" />
              <Select
                id="et-pol"
                value={editPolice}
                onChange={(e) =>
                  setEditPolice(e.target.value as PoliceVerificationStatus)
                }
              >
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="verified">Verified</option>
                <option value="not_required">Not Required</option>
              </Select>
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="et-addr" label="Permanent Address" />
            <Textarea
              id="et-addr"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={savingEdit}
            >
              Cancel
            </Button>
            <Button type="submit" loading={savingEdit}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Checkout Modal */}
      <Modal
        open={checkoutOpen}
        onClose={() => !checkingOut && setCheckoutOpen(false)}
        title={`Checkout — ${tenant.full_name}`}
        subtitle={`Room ${tenant.room_number} · Bed ${tenant.bed_code} will be released`}
      >
        <form onSubmit={handleCheckoutSubmit} className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Deposit Held</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatINR(heldNum)}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-slate-500">Deduction</span>
              <span className="font-semibold tabular-nums text-rose-700">
                -{formatINR(deductNum)}
              </span>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2">
              <span className="font-semibold text-slate-900">Refundable Deposit</span>
              <span className="text-sm font-bold tabular-nums text-emerald-700">
                {formatINR(refundPreview)}
              </span>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="co-date" label="Leaving Date" required />
            <Input
              id="co-date"
              type="date"
              value={leavingDate}
              onChange={(e) => setLeavingDate(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel
                htmlFor="co-ded"
                label="Deposit Deduction (₹)"
                hint={`Max ₹${heldNum}`}
              />
              <Input
                id="co-ded"
                type="number"
                min={0}
                max={heldNum}
                step="0.01"
                value={deductionAmount}
                onChange={(e) => setDeductionAmount(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="co-reason" label="Deduction Reason" />
              <Input
                id="co-reason"
                placeholder="e.g. Painting / key loss"
                value={deductionReason}
                onChange={(e) => setDeductionReason(e.target.value)}
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="co-remarks" label="Checkout Remarks" />
            <Textarea
              id="co-remarks"
              placeholder="Room handover condition, key return notes..."
              value={checkoutRemarks}
              onChange={(e) => setCheckoutRemarks(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-800">
            <input
              type="checkbox"
              checked={markMaintenance}
              onChange={(e) => setMarkMaintenance(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span>
              Mark Bed {tenant.bed_code} as <strong>Maintenance</strong> instead of Vacant
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCheckoutOpen(false)}
              disabled={checkingOut}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={checkingOut}>
              Confirm Checkout
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={previewDocUrl !== null}
        onClose={() => setPreviewDocUrl(null)}
        title="Private Document Preview"
        maxWidthClass="max-w-2xl"
      >
        {previewDocUrl ? (
          <AuthImage
            src={previewDocUrl}
            alt="Tenant KYC preview"
            className="max-h-[70vh] w-full rounded-xl object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}
