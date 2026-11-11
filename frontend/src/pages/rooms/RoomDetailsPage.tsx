import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BedDouble,
  Clock,
  Edit3,
  Plus,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/StateHelpers";
import { BedStatusBadge } from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  createBed,
  deleteBed,
  getRoomDetail,
  updateBed,
} from "@/services/roomService";
import { BedDetail, BedStatus, RoomDetail } from "@/types/api";

export function RoomDetailsPage() {
  const { roomId } = useParams();
  const { showToast } = useToast();
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [bedModalOpen, setBedModalOpen] = useState(false);
  const [editingBed, setEditingBed] = useState<BedDetail | null>(null);
  const [bedLabel, setBedLabel] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("7500");
  const [foodCharges, setFoodCharges] = useState("1000");
  const [bedStatus, setBedStatus] = useState<BedStatus>("vacant");
  const [savingBed, setSavingBed] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BedDetail | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRoom = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const data = await getRoomDetail(Number(roomId));
      setRoom(data);
    } catch (err) {
      showToast("error", "Failed to load room", extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [roomId, showToast]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  function openAddBed() {
    if (!room) return;
    setEditingBed(null);
    setBedLabel("");
    setMonthlyRent(String(parseFloat(room.base_rent)));
    setFoodCharges("1000");
    setBedStatus("vacant");
    setBedModalOpen(true);
  }

  function openEditBed(bed: BedDetail) {
    setEditingBed(bed);
    setBedLabel(bed.bed_label);
    setMonthlyRent(String(parseFloat(bed.monthly_rent)));
    setFoodCharges(String(parseFloat(bed.food_charges)));
    setBedStatus(bed.status);
    setBedModalOpen(true);
  }

  async function handleSaveBed(e: FormEvent) {
    e.preventDefault();
    if (!room) return;
    setSavingBed(true);
    try {
      if (editingBed) {
        await updateBed(editingBed.id, {
          bed_label: bedLabel,
          monthly_rent: monthlyRent,
          food_charges: foodCharges,
          status: editingBed.status === "occupied" ? undefined : bedStatus,
        });
        showToast("success", "Bed Updated", `Bed ${editingBed.bed_code} updated.`);
      } else {
        await createBed({
          room_id: room.id,
          bed_label: bedLabel,
          monthly_rent: monthlyRent,
          food_charges: foodCharges,
          status: bedStatus === "occupied" ? "vacant" : bedStatus,
        });
        showToast(
          "success",
          "Bed Added",
          `Bed ${room.room_number}-${bedLabel.toUpperCase()} added.`
        );
      }
      setBedModalOpen(false);
      await loadRoom();
    } catch (err) {
      showToast("error", "Bed Save Failed", extractApiError(err));
    } finally {
      setSavingBed(false);
    }
  }

  async function handleConfirmDeleteBed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBed(deleteTarget.id);
      showToast("success", "Bed Deleted", `Bed ${deleteTarget.bed_code} removed.`);
      setDeleteTarget(null);
      await loadRoom();
    } catch (err) {
      showToast("error", "Cannot Delete Bed", extractApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <StatGridSkeleton count={4} />
        <TableSkeleton rows={4} />
      </div>
    );
  }

  if (!room) {
    return (
      <EmptyState
        icon={<BedDouble className="h-6 w-6" />}
        title="Room not found"
        description="The requested room does not exist or belongs to another PG."
        action={
          <Link to="/rooms">
            <Button>Back to Rooms</Button>
          </Link>
        }
      />
    );
  }

  const columns: ColumnDef<BedDetail>[] = [
    {
      key: "code",
      header: "Bed Code",
      render: (bed) => (
        <span className="font-semibold text-slate-900">{bed.bed_code}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (bed) => <BedStatusBadge status={bed.status} />,
    },
    {
      key: "rent",
      header: "Monthly Rent",
      align: "right",
      render: (bed) => (
        <span className="font-medium text-slate-900">
          {formatINR(bed.monthly_rent)}
        </span>
      ),
    },
    {
      key: "food",
      header: "Food Charges",
      align: "right",
      render: (bed) => (
        <span className="text-slate-600">{formatINR(bed.food_charges)}</span>
      ),
    },
    {
      key: "occupant",
      header: "Current Occupant",
      render: (bed) =>
        bed.occupant_tenant_id ? (
          <Link
            to={`/tenants/${bed.occupant_tenant_id}`}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            {bed.occupant_name}
          </Link>
        ) : (
          <span className="text-xs text-slate-400">Unassigned</span>
        ),
    },
    {
      key: "updated",
      header: "Updated",
      render: (bed) => (
        <span className="text-xs text-slate-500">{formatDate(bed.updated_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (bed) => (
        <div className="inline-flex items-center gap-1.5">
          {bed.status === "vacant" ? (
            <Link to={`/tenants/new?bedId=${bed.id}`}>
              <Button size="sm">
                <UserPlus className="h-3.5 w-3.5" />
                <span>Assign</span>
              </Button>
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEditBed(bed)}
            aria-label={`Edit bed ${bed.bed_code}`}
          >
            <Edit3 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeleteTarget(bed)}
            aria-label={`Delete bed ${bed.bed_code}`}
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Operations" },
          { label: "Rooms", to: "/rooms" },
          { label: `Room ${room.room_number}` },
        ]}
        title={`Room ${room.room_number}`}
        subtitle={`${room.floor} · Base Rent ${formatINR(room.base_rent)} · Capacity ${
          room.total_beds
        }/${room.max_capacity} beds`}
        badge={
          <Badge tone="info" className="capitalize">
            {room.sharing_type}
          </Badge>
        }
        actions={
          <>
            <Link to="/rooms">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Rooms</span>
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={openAddBed}
              disabled={room.total_beds >= room.max_capacity}
            >
              <Plus className="h-4 w-4" />
              <span>Add Bed</span>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Vacant" value={room.vacant_beds} icon={BedDouble} tone="emerald" />
        <StatCard label="Occupied" value={room.occupied_beds} icon={BedDouble} tone="navy" />
        <StatCard
          label="Notice Period"
          value={room.notice_period_beds}
          icon={Clock}
          tone="amber"
        />
        <StatCard
          label="Maintenance"
          value={room.maintenance_beds}
          icon={Wrench}
          tone="rose"
        />
      </div>

      {room.description ? (
        <Card>
          <CardBody className="p-4 text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Room Notes: </span>
            {room.description}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={`Beds in Room ${room.room_number}`}
          subtitle="Manage bed pricing, occupancy status, and quick tenant allocation"
        />
        <DataTable
          columns={columns}
          data={room.beds}
          rowKey={(b) => b.id}
          emptyState={
            <div className="p-5">
              <EmptyState
                icon={<BedDouble className="h-6 w-6" />}
                title="No beds in this room"
                description="Add a bed to start allocating tenants."
                action={<Button onClick={openAddBed}>Add Bed</Button>}
              />
            </div>
          }
        />
      </Card>

      <Modal
        open={bedModalOpen}
        onClose={() => !savingBed && setBedModalOpen(false)}
        title={
          editingBed
            ? `Edit Bed ${editingBed.bed_code}`
            : `Add Bed to Room ${room.room_number}`
        }
      >
        <form onSubmit={handleSaveBed} className="space-y-4">
          <div>
            <FieldLabel
              htmlFor="bed-lbl"
              label="Bed Label"
              required
              hint="e.g. A, B, C"
            />
            <Input
              id="bed-lbl"
              value={bedLabel}
              onChange={(e) => setBedLabel(e.target.value)}
              placeholder="A"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="bed-rent" label="Monthly Rent (₹)" required />
              <Input
                id="bed-rent"
                type="number"
                min={1}
                step="0.01"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="bed-food" label="Food Charges (₹)" />
              <Input
                id="bed-food"
                type="number"
                min={0}
                step="0.01"
                value={foodCharges}
                onChange={(e) => setFoodCharges(e.target.value)}
              />
            </div>
          </div>

          {editingBed?.status !== "occupied" ? (
            <div>
              <FieldLabel htmlFor="bed-status" label="Bed Status" />
              <Select
                id="bed-status"
                value={bedStatus}
                onChange={(e) => setBedStatus(e.target.value as BedStatus)}
              >
                <option value="vacant">Vacant</option>
                <option value="maintenance">Maintenance</option>
                {editingBed?.status === "notice_period" ? (
                  <option value="notice_period">Notice Period</option>
                ) : null}
              </Select>
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              This bed is currently occupied by{" "}
              <strong>{editingBed.occupant_name}</strong>. Use Tenant Checkout to release
              the bed.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBedModalOpen(false)}
              disabled={savingBed}
            >
              Cancel
            </Button>
            <Button type="submit" loading={savingBed}>
              {editingBed ? "Save Bed" : "Add Bed"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDeleteBed()}
        title={`Delete Bed ${deleteTarget?.bed_code ?? ""}?`}
        description="Beds with active or historical tenant allocations cannot be deleted. Use Maintenance status if temporarily unavailable."
        confirmLabel="Delete Bed"
        destructive
        loading={deleting}
      />
    </div>
  );
}
