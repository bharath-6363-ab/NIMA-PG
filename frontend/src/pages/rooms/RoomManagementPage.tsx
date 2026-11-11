import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BedDouble,
  DoorOpen,
  Edit3,
  Eye,
  Home,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldLabel, Input, SearchInput, Select, Textarea } from "@/components/ui/Input";
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
  createRoom,
  deleteRoom,
  listRooms,
  updateRoom,
} from "@/services/roomService";
import { RoomDetail, SharingType } from "@/types/api";

const SHARING_DEFAULT_CAPACITY: Record<SharingType, number> = {
  single: 1,
  double: 2,
  triple: 3,
  quad: 4,
  shared: 4,
};

export function RoomManagementPage() {
  const { showToast } = useToast();
  const [rooms, setRooms] = useState<RoomDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("");

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomDetail | null>(null);
  const [roomNumber, setRoomNumber] = useState("");
  const [floor, setFloor] = useState("1st Floor");
  const [sharingType, setSharingType] = useState<SharingType>("double");
  const [maxCapacity, setMaxCapacity] = useState("2");
  const [baseRent, setBaseRent] = useState("7500");
  const [foodCharges, setFoodCharges] = useState("1000");
  const [description, setDescription] = useState("");
  const [autoCreateBeds, setAutoCreateBeds] = useState(true);
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<RoomDetail | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRooms({
        search: search.trim() || undefined,
        availability: availability || undefined,
      });
      setRooms(data);
    } catch (err) {
      showToast("error", "Failed to load rooms", extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [availability, search, showToast]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  function openAddModal() {
    setEditingRoom(null);
    setRoomNumber("");
    setFloor("1st Floor");
    setSharingType("double");
    setMaxCapacity("2");
    setBaseRent("7500");
    setFoodCharges("1000");
    setDescription("");
    setAutoCreateBeds(true);
    setModalOpen(true);
  }

  function openEditModal(room: RoomDetail) {
    setEditingRoom(room);
    setRoomNumber(room.room_number);
    setFloor(room.floor);
    setSharingType(room.sharing_type);
    setMaxCapacity(String(room.max_capacity));
    setBaseRent(String(parseFloat(room.base_rent)));
    setFoodCharges("0");
    setDescription(room.description ?? "");
    setAutoCreateBeds(false);
    setModalOpen(true);
  }

  async function handleSaveRoom(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const capNum = parseInt(maxCapacity, 10);
      if (Number.isNaN(capNum) || capNum < 1) {
        showToast("error", "Invalid Capacity", "Capacity must be at least 1.");
        setSaving(false);
        return;
      }

      if (editingRoom) {
        await updateRoom(editingRoom.id, {
          room_number: roomNumber,
          floor,
          sharing_type: sharingType,
          max_capacity: capNum,
          base_rent: baseRent,
          description,
        });
        showToast("success", "Room Updated", `Room ${roomNumber} saved.`);
      } else {
        await createRoom({
          room_number: roomNumber,
          floor,
          sharing_type: sharingType,
          max_capacity: capNum,
          base_rent: baseRent,
          food_charges: foodCharges,
          description: description || undefined,
          auto_create_beds: autoCreateBeds,
        });
        showToast("success", "Room Created", `Room ${roomNumber} added.`);
      }
      setModalOpen(false);
      await loadRooms();
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
      await deleteRoom(deleteTarget.id);
      showToast("success", "Room Deleted", `Room ${deleteTarget.room_number} removed.`);
      setDeleteTarget(null);
      await loadRooms();
    } catch (err) {
      showToast("error", "Cannot Delete Room", extractApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  const totalBeds = rooms.reduce((acc, r) => acc + r.total_beds, 0);
  const vacantBeds = rooms.reduce((acc, r) => acc + r.vacant_beds, 0);
  const occupiedBeds = rooms.reduce(
    (acc, r) => acc + r.occupied_beds + r.notice_period_beds,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Rooms" }]}
        title="Room Management"
        subtitle="Configure room inventory, sharing capacities, base monthly rents, and monitor live bed availability."
        actions={
          <>
            <Link to="/beds">
              <Button variant="outline" size="sm">
                <BedDouble className="h-4 w-4" />
                <span>All Beds</span>
              </Button>
            </Link>
            <Button size="sm" onClick={openAddModal}>
              <Plus className="h-4 w-4" />
              <span>Add Room</span>
            </Button>
          </>
        }
      />

      {loading && rooms.length === 0 ? (
        <>
          <StatGridSkeleton count={4} />
          <TableSkeleton rows={4} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total Rooms" value={rooms.length} icon={DoorOpen} tone="navy" />
            <StatCard label="Total Beds" value={totalBeds} icon={BedDouble} tone="neutral" />
            <StatCard
              label="Vacant Beds"
              value={vacantBeds}
              sublabel="Ready to assign"
              icon={Home}
              tone="emerald"
            />
            <StatCard
              label="Occupied / Notice"
              value={occupiedBeds}
              sublabel="Active allocations"
              icon={BedDouble}
              tone="blue"
            />
          </div>

          <Card>
            <CardHeader
              title="PG Rooms & Bed Inventory"
              subtitle="Search by room number or filter by current availability"
            />
            <CardBody className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <SearchInput
                  className="sm:col-span-2"
                  placeholder="Search room number, floor, or description..."
                  value={search}
                  onChange={setSearch}
                />
                <Select
                  aria-label="Filter by availability"
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value)}
                >
                  <option value="">All Availability</option>
                  <option value="vacant">Has Vacant Beds</option>
                  <option value="full">Fully Occupied</option>
                  <option value="maintenance">Has Maintenance Beds</option>
                </Select>
              </div>

              {loading ? (
                <TableSkeleton rows={4} />
              ) : rooms.length === 0 ? (
                <EmptyState
                  icon={<DoorOpen className="h-6 w-6" />}
                  title="No rooms match your filter"
                  description="Add a new room or adjust your search and availability filters."
                  action={<Button onClick={openAddModal}>Add Room</Button>}
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {rooms.map((room) => {
                    const occPct =
                      room.total_beds > 0
                        ? Math.round((room.occupied_beds / room.total_beds) * 100)
                        : 0;
                    return (
                      <Card
                        key={room.id}
                        interactive
                        className="flex flex-col justify-between p-5"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-base font-semibold text-slate-900">
                                  Room {room.room_number}
                                </h3>
                                <Badge tone="info" className="capitalize">
                                  {room.sharing_type}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {room.floor} · Base{" "}
                                <span className="font-medium tabular-nums text-slate-700">
                                  {formatINR(room.base_rent)}/mo
                                </span>{" "}
                                · {room.total_beds}/{room.max_capacity} beds
                              </p>
                            </div>
                            <Badge tone={room.vacant_beds > 0 ? "success" : "neutral"} dot>
                              {room.vacant_beds > 0
                                ? `${room.vacant_beds} Vacant`
                                : "Full"}
                            </Badge>
                          </div>

                          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-navy-900 transition-all"
                              style={{ width: `${occPct}%` }}
                            />
                          </div>

                          {room.description ? (
                            <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
                              {room.description}
                            </p>
                          ) : null}

                          <div className="mt-3.5 flex flex-wrap gap-2">
                            {room.beds.length === 0 ? (
                              <span className="text-xs italic text-slate-400">
                                No beds configured yet
                              </span>
                            ) : (
                              room.beds.map((bed) => (
                                <div
                                  key={bed.id}
                                  className="flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1 text-xs"
                                >
                                  <span className="font-semibold text-slate-800">
                                    {bed.bed_code}
                                  </span>
                                  <BedStatusBadge status={bed.status} />
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                          <Link to={`/rooms/${room.id}`}>
                            <Button size="sm" variant="outline">
                              <Eye className="h-3.5 w-3.5" />
                              <span>Manage Room &amp; Beds</span>
                            </Button>
                          </Link>

                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditModal(room)}
                              aria-label={`Edit room ${room.room_number}`}
                              title="Edit Room"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteTarget(room)}
                              aria-label={`Delete room ${room.room_number}`}
                              title="Delete Room"
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* Add / Edit Room Modal */}
      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editingRoom ? `Edit Room ${editingRoom.room_number}` : "Add New Room"}
        subtitle="Configure room capacity, type, and base monthly rent"
      >
        <form onSubmit={handleSaveRoom} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="rm-num" label="Room Number" required />
              <Input
                id="rm-num"
                placeholder="e.g. 203"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="rm-floor" label="Floor" />
              <Input
                id="rm-floor"
                placeholder="e.g. 2nd Floor"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="rm-type" label="Room Type" required />
              <Select
                id="rm-type"
                value={sharingType}
                onChange={(e) => {
                  const val = e.target.value as SharingType;
                  setSharingType(val);
                  if (!editingRoom) {
                    setMaxCapacity(String(SHARING_DEFAULT_CAPACITY[val]));
                  }
                }}
              >
                <option value="single">Single</option>
                <option value="double">Double</option>
                <option value="triple">Triple</option>
                <option value="quad">Quad</option>
                <option value="shared">Shared (Configurable)</option>
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="rm-cap" label="Max Bed Capacity" required />
              <Input
                id="rm-cap"
                type="number"
                min={1}
                max={20}
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="rm-rent" label="Base Monthly Rent (₹)" required />
              <Input
                id="rm-rent"
                type="number"
                min={1}
                step="0.01"
                value={baseRent}
                onChange={(e) => setBaseRent(e.target.value)}
                required
              />
            </div>
            {!editingRoom ? (
              <div>
                <FieldLabel htmlFor="rm-food" label="Default Food Charges (₹)" />
                <Input
                  id="rm-food"
                  type="number"
                  min={0}
                  step="0.01"
                  value={foodCharges}
                  onChange={(e) => setFoodCharges(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          <div>
            <FieldLabel htmlFor="rm-desc" label="Description (Optional)" />
            <Textarea
              id="rm-desc"
              placeholder="Attached balcony, wardrobe, study table..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {!editingRoom ? (
            <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={autoCreateBeds}
                onChange={(e) => setAutoCreateBeds(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              <span>Automatically generate vacant beds up to capacity</span>
            </label>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editingRoom ? "Save Changes" : "Create Room"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
        title={`Delete Room ${deleteTarget?.room_number ?? ""}?`}
        description="Rooms can only be deleted when no beds are occupied and no historical tenant or complaint records reference them."
        confirmLabel="Delete Room"
        destructive
        loading={deleting}
      />
    </div>
  );
}
