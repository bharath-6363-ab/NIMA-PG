import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BedDouble,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Home,
  Link2,
  RefreshCw,
  Trash2,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input, SearchInput, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/StateHelpers";
import { BedStatusBadge } from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  createVacancyShareLink,
  fetchVacancyOverview,
  revokeVacancyShareLink,
  updateVacancyBed,
} from "@/services/ownerService";
import {
  BedStatus,
  BedVacancy,
  OwnerVacancyDashboard,
  VacancyShareLink,
} from "@/types/api";

export function VacancyManagementPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const { showToast } = useToast();

  const [data, setData] = useState<OwnerVacancyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedPgId, setSelectedPgId] = useState<number | undefined>(undefined);
  const [roomFilter, setRoomFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<BedStatus | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [publicOnly, setPublicOnly] = useState(false);

  // Maintenance status confirm dialog
  const [maintTarget, setMaintTarget] = useState<BedVacancy | null>(null);
  const [updatingBedId, setUpdatingBedId] = useState<number | null>(null);

  // Owner-only Share Link Modal & Revoke confirm
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTitle, setShareTitle] = useState("Live Bed Availability");
  const [shareDays, setShareDays] = useState("30");
  const [creatingLink, setCreatingLink] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<VacancyShareLink | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadVacancy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchVacancyOverview({
        pg_id: selectedPgId,
        room_id: roomFilter ? Number(roomFilter) : undefined,
        status: statusFilter,
        search: searchQuery,
        public_only: publicOnly,
      });
      setData(res);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [selectedPgId, roomFilter, statusFilter, searchQuery, publicOnly]);

  useEffect(() => {
    void loadVacancy();
  }, [loadVacancy]);

  async function handleTogglePublicAvailability(bed: BedVacancy) {
    setUpdatingBedId(bed.id);
    try {
      await updateVacancyBed(
        bed.id,
        { is_publicly_available: !(bed.is_publicly_available ?? true) },
        selectedPgId
      );
      showToast(
        "success",
        `Bed ${bed.bed_code} ${
          bed.is_publicly_available ? "hidden from" : "listed on"
        } public vacancy pages.`
      );
      await loadVacancy();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setUpdatingBedId(null);
    }
  }

  async function handleConfirmMaintenanceChange() {
    if (!maintTarget) return;
    const targetStatus: BedStatus =
      maintTarget.status === "maintenance" ? "vacant" : "maintenance";
    setUpdatingBedId(maintTarget.id);
    try {
      await updateVacancyBed(maintTarget.id, { status: targetStatus }, selectedPgId);
      showToast("success", `Bed ${maintTarget.bed_code} updated to ${targetStatus}.`);
      setMaintTarget(null);
      await loadVacancy();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setUpdatingBedId(null);
    }
  }

  async function handleCreateShareLink(e: FormEvent) {
    e.preventDefault();
    setCreatingLink(true);
    try {
      const days = parseInt(shareDays, 10);
      await createVacancyShareLink(
        {
          title: shareTitle.trim() || "Live Bed Availability",
          expires_in_days: Number.isNaN(days) ? 30 : days,
        },
        selectedPgId
      );
      showToast("success", "Public vacancy share link generated.");
      setShareOpen(false);
      await loadVacancy();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setCreatingLink(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeVacancyShareLink(revokeTarget.id);
      showToast("info", "Public vacancy link revoked.");
      setRevokeTarget(null);
      await loadVacancy();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setRevoking(false);
    }
  }

  async function handleCopyShareUrl(sharePath: string) {
    const full = `${window.location.origin}${sharePath}`;
    try {
      await navigator.clipboard.writeText(full);
      showToast("success", "Public vacancy link copied to clipboard.");
    } catch {
      showToast("info", `Share URL: ${full}`);
    }
  }

  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
        title="Unable to load vacancy dashboard"
        description={error ?? "Please verify permissions and try again."}
        action={<Button onClick={loadVacancy}>Retry</Button>}
      />
    );
  }

  const uniqueRooms = Array.from(
    new Map(data.beds.map((b) => [b.room_id, b.room_number])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const noticeBeds = data.beds.filter((b) => b.status === "notice_period");

  const columns: ColumnDef<BedVacancy>[] = [
    {
      key: "bed",
      header: "Room & Bed",
      render: (bed) => (
        <div>
          <p className="font-semibold text-slate-900">{bed.bed_code}</p>
          <p className="text-[11px] text-slate-500">Room {bed.room_number}</p>
        </div>
      ),
    },
    {
      key: "sharing",
      header: "Sharing / Floor",
      render: (bed) => (
        <span className="text-xs capitalize text-slate-600">
          {bed.sharing_type} · {bed.floor}
        </span>
      ),
    },
    {
      key: "rent",
      header: "Monthly Rent",
      align: "right",
      render: (bed) => (
        <span className="font-semibold text-slate-900">
          {formatINR(bed.monthly_rent)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (bed) => <BedStatusBadge status={bed.status} />,
    },
    {
      key: "occupant",
      header: "Occupant / Vacancy",
      render: (bed) =>
        bed.occupant_name ? (
          <div>
            <p className="text-xs font-medium text-slate-900">{bed.occupant_name}</p>
            {bed.expected_leaving_date ? (
              <p className="text-[11px] text-amber-700">
                Leaves {formatDate(bed.expected_leaving_date)}
              </p>
            ) : null}
          </div>
        ) : bed.status === "vacant" ? (
          <span className="text-xs font-medium text-emerald-700">
            Vacant {bed.days_vacant} day{bed.days_vacant === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Under Maintenance</span>
        ),
    },
    {
      key: "public",
      header: "Public Listing",
      render: (bed) => (
        <Button
          size="sm"
          variant="outline"
          disabled={updatingBedId === bed.id}
          onClick={() => void handleTogglePublicAvailability(bed)}
        >
          {bed.is_publicly_available !== false ? (
            <>
              <Eye className="h-3.5 w-3.5 text-emerald-600" />
              <span>Public</span>
            </>
          ) : (
            <>
              <EyeOff className="h-3.5 w-3.5 text-slate-400" />
              <span>Hidden</span>
            </>
          )}
        </Button>
      ),
    },
    {
      key: "maintenance",
      header: "Maintenance",
      align: "right",
      render: (bed) =>
        bed.status === "vacant" || bed.status === "maintenance" ? (
          <Button
            size="sm"
            variant={bed.status === "maintenance" ? "primary" : "outline"}
            disabled={updatingBedId === bed.id}
            onClick={() => setMaintTarget(bed)}
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>{bed.status === "maintenance" ? "Mark Vacant" : "Maintenance"}</span>
          </Button>
        ) : (
          <span className="text-[11px] text-slate-400">Checkout first</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Vacancy Board" }]}
        title="Vacancy & Occupancy Management"
        subtitle="Track vacant, occupied, notice-period, and maintenance beds, control public availability, and publish zero-PII vacancy links."
        actions={
          <>
            {isOwner ? (
              <Button size="sm" onClick={() => setShareOpen(true)}>
                <Link2 className="h-4 w-4" />
                <span>Create Share Link</span>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={loadVacancy}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Beds" value={data.total_beds} icon={BedDouble} tone="navy" />
        <StatCard label="Occupied" value={data.occupied_beds} icon={Home} tone="neutral" />
        <StatCard
          label="Vacant Now"
          value={data.vacant_beds}
          icon={BedDouble}
          tone="emerald"
        />
        <StatCard
          label="Notice Period"
          value={data.notice_period_beds}
          icon={Clock}
          tone="amber"
        />
        <StatCard
          label="Maintenance"
          value={data.maintenance_beds}
          icon={Wrench}
          tone="rose"
        />
        <StatCard
          label="Occupancy Rate"
          value={`${data.occupancy_percentage ?? 0}%`}
          sublabel={
            isOwner
              ? `Potential ${formatINR(data.vacant_monthly_potential)}/mo`
              : undefined
          }
          icon={TrendingUp}
          tone="blue"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          {isOwner && data.properties && data.properties.length > 1 ? (
            <div>
              <FieldLabel htmlFor="vac-pg" label="PG Property" />
              <Select
                id="vac-pg"
                value={String(selectedPgId ?? data.pg_id ?? "")}
                onChange={(e) => setSelectedPgId(Number(e.target.value))}
              >
                {data.properties.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div>
            <FieldLabel htmlFor="vac-search" label="Search Room / Bed / Tenant" />
            <SearchInput
              id="vac-search"
              placeholder="Room, bed code, occupant..."
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>

          <div>
            <FieldLabel htmlFor="vac-room" label="Room" />
            <Select
              id="vac-room"
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
            >
              <option value="">All Rooms</option>
              {uniqueRooms.map(([id, num]) => (
                <option key={id} value={String(id)}>
                  Room {num}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <FieldLabel htmlFor="vac-status" label="Bed Status" />
            <Select
              id="vac-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as BedStatus | "")}
            >
              <option value="">All Statuses</option>
              <option value="vacant">Vacant</option>
              <option value="notice_period">Notice Period (Expected Vacant)</option>
              <option value="occupied">Occupied</option>
              <option value="maintenance">Maintenance</option>
            </Select>
          </div>

          <div className="flex items-end">
            <label className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={publicOnly}
                onChange={(e) => setPublicOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              <span>Publicly Listed Only</span>
            </label>
          </div>
        </CardBody>
      </Card>

      {noticeBeds.length > 0 ? (
        <Card className="border-amber-200/80 bg-amber-50/40">
          <CardHeader
            title={`Beds Expected to Become Vacant (${noticeBeds.length} on Notice Period)`}
            subtitle="Residents currently serving notice — prepare turnover or publish availability ahead of exit"
          />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {noticeBeds.map((b) => (
              <div
                key={`notice-${b.id}`}
                className="rounded-xl border border-amber-200/80 bg-white p-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    Room {b.room_number} · Bed {b.bed_code}
                  </span>
                  <BedStatusBadge status={b.status} />
                </div>
                <p className="mt-1 text-slate-600">
                  Resident: <strong>{b.occupant_name ?? "Resident"}</strong>
                </p>
                {b.expected_leaving_date ? (
                  <p className="text-[11px] text-amber-800">
                    Expected Exit: {formatDate(b.expected_leaving_date)}
                  </p>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Room & Bed Vacancy Status"
          subtitle={`${data.beds.length} bed${data.beds.length === 1 ? "" : "s"} matching filters`}
        />
        <DataTable
          columns={columns}
          data={data.beds}
          rowKey={(b) => b.id}
          emptyState={
            <div className="p-5">
              <EmptyState
                icon={<BedDouble className="h-5 w-5" />}
                title="No matching beds"
                description="Adjust your room, status, or search filters."
              />
            </div>
          }
        />
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader
            title="Public Shareable Vacancy Links (Zero Tenant PII)"
            subtitle="Prospects see only beds marked Publicly Listed without resident names or contact details"
            action={
              <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                <Link2 className="h-4 w-4" />
                <span>New Share Link</span>
              </Button>
            }
          />
          <CardBody>
            {data.share_links.length === 0 ? (
              <EmptyState
                icon={<Link2 className="h-5 w-5" />}
                title="No active public vacancy links"
                description="Generate a shareable link to advertise vacant beds safely without exposing resident information."
                action={
                  <Button size="sm" onClick={() => setShareOpen(true)}>
                    Generate Share Link
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {data.share_links.map((link) => (
                  <div
                    key={link.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{link.title}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-brand-700">
                        {link.share_path}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Expires: {link.expires_at ? formatDate(link.expires_at) : "Never"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCopyShareUrl(link.share_path)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy URL</span>
                      </Button>
                      <a
                        href={link.share_path}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Preview</span>
                      </a>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setRevokeTarget(link)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Revoke</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={shareOpen}
        onClose={() => !creatingLink && setShareOpen(false)}
        title="Create Public Vacancy Listing Link"
        subtitle="Prospective residents see available room types, monthly rent & amenities — never tenant names or phone numbers."
      >
        <form onSubmit={handleCreateShareLink} className="space-y-4">
          <div>
            <FieldLabel htmlFor="share-title" label="Listing Title" required />
            <Input
              id="share-title"
              value={shareTitle}
              onChange={(e) => setShareTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <FieldLabel htmlFor="share-days" label="Expiry (Days)" />
            <Input
              id="share-days"
              type="number"
              min="1"
              max="365"
              value={shareDays}
              onChange={(e) => setShareDays(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShareOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={creatingLink}>
              Generate Public Link
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(maintTarget)}
        onClose={() => setMaintTarget(null)}
        onConfirm={handleConfirmMaintenanceChange}
        title="Update Bed Status"
        description={
          maintTarget
            ? `Change Bed ${maintTarget.bed_code} from ${maintTarget.status} to ${
                maintTarget.status === "maintenance" ? "vacant" : "maintenance"
              }?`
            : ""
        }
        confirmLabel="Confirm Status Change"
        loading={Boolean(updatingBedId)}
      />

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleConfirmRevoke}
        title="Revoke Public Share Link"
        description={
          revokeTarget
            ? `Deactivate "${revokeTarget.title}" immediately? Anyone opening that link will no longer see bed availability.`
            : ""
        }
        confirmLabel="Revoke Link"
        destructive
        loading={revoking}
      />
    </div>
  );
}
