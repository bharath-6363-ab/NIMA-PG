import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BedDouble,
  Clock,
  Edit3,
  Plus,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input, SearchInput, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/StateHelpers";
import { BedStatusBadge } from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  createBed,
  deleteBed,
  listBeds,
  listRooms,
  updateBed,
} from "@/services/roomService";
import { BedDetail, BedStatus, RoomDetail } from "@/types/api";

export function BedManagementPage() {
  const { showToast } = useToast();
  const [beds, setBeds] = useState<BedDetail[]>([]);
  const [rooms, setRooms] = useState<RoomDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [roomFilter, setRoomFilter] = useState<string>("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBed, setEditingBed] = useState<BedDetail | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [bedLabel, setBedLabel] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("7500");
  const [foodCharges, setFoodCharges] = useState("1000");
  const [bedStatus, setBedStatus] = useState<BedStatus>("vacant");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BedDetail | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bedsData, roomsData] = await Promise.all([
        listBeds({
          room_id: roomFilter ? Number(roomFilter) : undefined,
          status: (statusFilter as BedStatus) || undefined,
          search: search.trim() || undefined,
        }),
        listRooms(),
      ]);
      setBeds(bedsData);
      setRooms(roomsData);
    } catch (err) {
      showToast("error", "Failed to load beds", extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [roomFilter, search, showToast, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openAddModal() {
    const firstAvailableRoom = rooms.find((r) => r.total_beds < r.max_capacity) ?? rooms[0];
    setEditingBed(null);
    setSelectedRoomId(firstAvailableRoom ? String(firstAvailableRoom.id) : "");
    setBedLabel("");
    setMonthlyRent(
      firstAvailableRoom ? String(parseFloat(firstAvailableRoom.base_rent)) : "7500"
    );
    setFoodCharges("1000");
    setBedStatus("vacant");
    setModalOpen(true);
  }

  function openEditModal(bed: BedDetail) {
    setEditingBed(bed);
    setSelectedRoomId(String(bed.room_id));
    setBedLabel(bed.bed_label);
    setMonthlyRent(String(parseFloat(bed.monthly_rent)));
    setFoodCharges(String(parseFloat(bed.food_charges)));
    setBedStatus(bed.status);
    setModalOpen(true);
  }

  async function handleSaveBed(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
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
          room_id: Number(selectedRoomId),
          bed_label: bedLabel,
          monthly_rent: monthlyRent,
          food_charges: foodCharges,
          status: bedStatus === "occupied" ? "vacant" : bedStatus,
        });
        showToast("success", "Bed Created", "New bed added to room.");
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      showToast("error", "Save Failed", extractApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBed(deleteTarget.id);
      showToast("success", "Bed Deleted", `Bed ${deleteTarget.bed_code} deleted.`);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      showToast("error", "Cannot Delete Bed", extractApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  const vacantCount = beds.filter((b) => b.status === "vacant").length;
  const occupiedCount = beds.filter((b) => b.status === "occupied").length;
  const noticeCount = beds.filter((b) => b.status === "notice_period").length;
  const maintCount = beds.filter((b) => b.status === "maintenance").length;

  const columns: ColumnDef<BedDetail>[] = [
    {
      key: "bed",
      header: "Bed",
      render: (bed) => (
        <span className="font-semibold text-slate-900">{bed.bed_code}</span>
      ),
    },
    {
      key: "room",
      header: "Room",
      render: (bed) => (
        <span className="text-xs text-slate-600">
          <Link
            to={`/rooms/${bed.room_id}`}
            className="font-semibold text-brand-700 hover:underline"
          >
            Room {bed.room_number}
          </Link>{" "}
          · {bed.floor}
        </span>
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
      header: "Occupant",
      render: (bed) =>
        bed.occupant_tenant_id ? (
          <Link
            to={`/tenants/${bed.occupant_tenant_id}`}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            {bed.occupant_name}
          </Link>
        ) : (
          <span className="text-xs text-slate-400">Available</span>
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
            onClick={() => openEditModal(bed)}
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
          { label: "Beds" },
        ]}
        title="Bed Management"
        subtitle="Track individual bed rates, occupancy statuses, and assign vacant beds directly to residents."
        actions={
          <Button size="sm" onClick={openAddModal} disabled={rooms.length === 0}>
            <Plus className="h-4 w-4" />
            <span>Add Bed</span>
          </Button>
        }
      />

      {loading && beds.length === 0 ? (
        <>
          <StatGridSkeleton count={4} />
          <TableSkeleton rows={6} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Vacant" value={vacantCount} icon={BedDouble} tone="emerald" />
            <StatCard label="Occupied" value={occupiedCount} icon={BedDouble} tone="navy" />
            <StatCard label="Notice Period" value={noticeCount} icon={Clock} tone="amber" />
            <StatCard label="Maintenance" value={maintCount} icon={Wrench} tone="rose" />
          </div>

          <Card>
            <CardHeader title="All PG Beds" subtitle="Filter by room or bed status" />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <SearchInput
                  placeholder="Search bed code, room, occupant..."
                  value={search}
                  onChange={setSearch}
                />
                <Select
                  aria-label="Filter by bed status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="vacant">Vacant</option>
                  <option value="occupied">Occupied</option>
                  <option value="notice_period">Notice Period</option>
                  <option value="maintenance">Maintenance</option>
                </Select>
                <Select
                  aria-label="Filter by room"
                  value={roomFilter}
                  onChange={(e) => setRoomFilter(e.target.value)}
                >
                  <option value="">All Rooms</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.room_number} ({r.floor})
                    </option>
                  ))}
                </Select>
              </div>

              {loading ? (
                <TableSkeleton rows={5} />
              ) : (
                <DataTable
                  columns={columns}
                  data={beds}
                  rowKey={(b) => b.id}
                  emptyState={
                    <EmptyState
                      icon={<BedDouble className="h-6 w-6" />}
                      title="No beds found"
                      description="Try clearing filters or add a bed to a room."
                    />
                  }
                />
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editingBed ? `Edit Bed ${editingBed.bed_code}` : "Add New Bed"}
      >
        <form onSubmit={handleSaveBed} className="space-y-4">
          {!editingBed ? (
            <div>
              <FieldLabel htmlFor="bm-room" label="Room" required />
              <Select
                id="bm-room"
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                required
              >
                {rooms.map((r) => (
                  <option
                    key={r.id}
                    value={r.id}
                    disabled={r.total_beds >= r.max_capacity}
                  >
                    Room {r.room_number} ({r.total_beds}/{r.max_capacity} beds)
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div>
            <FieldLabel htmlFor="bm-lbl" label="Bed Label" required />
            <Input
              id="bm-lbl"
              placeholder="e.g. C"
              value={bedLabel}
              onChange={(e) => setBedLabel(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="bm-rent" label="Monthly Rent (₹)" required />
              <Input
                id="bm-rent"
                type="number"
                min={1}
                step="0.01"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="bm-food" label="Food Charges (₹)" />
              <Input
                id="bm-food"
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
              <FieldLabel htmlFor="bm-status" label="Status" />
              <Select
                id="bm-status"
                value={bedStatus}
                onChange={(e) => setBedStatus(e.target.value as BedStatus)}
              >
                <option value="vacant">Vacant</option>
                <option value="maintenance">Maintenance</option>
              </Select>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Bed
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
        title={`Delete Bed ${deleteTarget?.bed_code ?? ""}?`}
        description="Beds with active or historical tenant allocations cannot be deleted."
        confirmLabel="Delete Bed"
        destructive
        loading={deleting}
      />
    </div>
  );
}
