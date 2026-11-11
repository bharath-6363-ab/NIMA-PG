import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarOff,
  CheckCircle2,
  Clock,
  Edit3,
  Globe,
  ImagePlus,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { AuthImage } from "@/components/shared/AuthImage";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/StateHelpers";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatDateTime } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  fetchManagerFoodOverview,
  saveWeeklyFoodMenu,
  setWeeklyMenuPublishState,
  updateSingleFoodSlot,
  uploadFoodSlotImage,
} from "@/services/foodService";
import {
  DayOfWeek,
  FoodMenuSlot,
  ManagerFoodOverview,
  MealType,
} from "@/types/api";

const DAYS: { key: DayOfWeek; label: string; short: string }[] = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

const MEALS: { key: MealType; label: string; defaultTiming: string }[] = [
  { key: "breakfast", label: "Breakfast", defaultTiming: "7:30 AM - 9:30 AM" },
  { key: "lunch", label: "Lunch", defaultTiming: "12:30 PM - 2:30 PM" },
  { key: "dinner", label: "Dinner", defaultTiming: "8:00 PM - 10:00 PM" },
];

type TabKey = "menu" | "skips" | "ratings";
type SkipRow = ManagerFoodOverview["skip_details"][number];

interface EditableDishItem {
  item_name: string;
  is_veg: boolean;
}

export function FoodManagementPage() {
  const { showToast } = useToast();
  const todayISO = new Date().toISOString().slice(0, 10);

  const [overview, setOverview] = useState<ManagerFoodOverview | null>(null);
  const [targetDate, setTargetDate] = useState<string>(todayISO);
  const [activeTab, setActiveTab] = useState<TabKey>("menu");
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>("monday");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Publish / Unpublish confirmation
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [desiredPublishState, setDesiredPublishState] = useState(true);
  const [publishing, setPublishing] = useState(false);

  // Edit single meal slot modal
  const [editDay, setEditDay] = useState<DayOfWeek>("monday");
  const [editMeal, setEditMeal] = useState<MealType>("breakfast");
  const [editSlotId, setEditSlotId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [mealName, setMealName] = useState("");
  const [timingLabel, setTimingLabel] = useState("");
  const [mealDescription, setMealDescription] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [dishItems, setDishItems] = useState<EditableDishItem[]>([]);
  const [newDishName, setNewDishName] = useState("");
  const [newDishVeg, setNewDishVeg] = useState(true);
  const [mealImageFile, setMealImageFile] = useState<File | null>(null);
  const [savingMeal, setSavingMeal] = useState(false);

  const loadFood = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManagerFoodOverview(targetDate);
      setOverview(data);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [targetDate]);

  useEffect(() => {
    void loadFood();
  }, [loadFood]);

  function openEditMealModal(day: DayOfWeek, meal: MealType, existing?: FoodMenuSlot) {
    const mealDef = MEALS.find((m) => m.key === meal);
    setEditDay(day);
    setEditMeal(meal);
    setEditSlotId(existing?.id ?? null);
    setMealName(
      existing?.meal_name ||
        `${day.charAt(0).toUpperCase() + day.slice(1)} ${mealDef?.label ?? meal}`
    );
    setTimingLabel(
      existing?.timing_label ?? mealDef?.defaultTiming ?? "8:00 AM - 9:30 AM"
    );
    setMealDescription(existing?.description ?? "");
    setIsAvailable(existing?.is_available ?? true);

    if (existing?.menu_items && existing.menu_items.length > 0) {
      setDishItems(
        existing.menu_items.map((it) => ({
          item_name: it.item_name,
          is_veg: it.is_veg,
        }))
      );
    } else if (existing?.items_description) {
      setDishItems(
        existing.items_description
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((name) => ({ item_name: name, is_veg: true }))
      );
    } else {
      setDishItems([{ item_name: "", is_veg: true }]);
    }
    setNewDishName("");
    setNewDishVeg(true);
    setMealImageFile(null);
    setEditOpen(true);
  }

  function handleAddDishItem() {
    if (!newDishName.trim()) return;
    setDishItems((prev) => [
      ...prev.filter((i) => i.item_name.trim()),
      { item_name: newDishName.trim(), is_veg: newDishVeg },
    ]);
    setNewDishName("");
  }

  async function handleSaveMeal(e: FormEvent) {
    e.preventDefault();
    const cleanedItems = dishItems.filter((i) => i.item_name.trim());
    if (cleanedItems.length === 0) {
      showToast("error", "Add at least one menu item for this meal.");
      return;
    }

    setSavingMeal(true);
    try {
      let savedSlot: FoodMenuSlot;
      if (editSlotId) {
        savedSlot = await updateSingleFoodSlot(editSlotId, {
          meal_name: mealName.trim() || undefined,
          description: mealDescription.trim() || null,
          timing_label: timingLabel.trim(),
          menu_items: cleanedItems,
          is_available: isAvailable,
        });
      } else {
        const res = await saveWeeklyFoodMenu([
          {
            day_of_week: editDay,
            meal_type: editMeal,
            meal_name: mealName.trim() || undefined,
            description: mealDescription.trim() || null,
            timing_label: timingLabel.trim(),
            menu_items: cleanedItems,
            is_available: isAvailable,
            is_published: overview?.is_menu_published ?? true,
          },
        ]);
        const found = res.find(
          (s) => s.day_of_week === editDay && s.meal_type === editMeal
        );
        if (!found) throw new Error("Saved meal slot not returned.");
        savedSlot = found;
      }

      if (mealImageFile) {
        await uploadFoodSlotImage(savedSlot.id, mealImageFile);
      }

      showToast("success", "Meal menu updated.");
      setEditOpen(false);
      await loadFood();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSavingMeal(false);
    }
  }

  async function handleConfirmPublish() {
    setPublishing(true);
    try {
      await setWeeklyMenuPublishState(desiredPublishState);
      showToast(
        "success",
        desiredPublishState
          ? "Weekly food menu published to tenants."
          : "Weekly food menu unpublished (hidden from tenants)."
      );
      setPublishConfirmOpen(false);
      await loadFood();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setPublishing(false);
    }
  }

  if (loading && !overview) {
    return <DashboardSkeleton />;
  }

  if (error || !overview) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
        title="Unable to load food management"
        description={error ?? "Please try again in a moment."}
        action={<Button onClick={loadFood}>Retry</Button>}
      />
    );
  }

  const published = overview.is_menu_published !== false;
  const daySlots = overview.weekly_menu.filter((s) => s.day_of_week === selectedDay);

  const skipColumns: ColumnDef<SkipRow>[] = [
    {
      key: "resident",
      header: "Resident",
      render: (row) => (
        <span className="font-semibold text-slate-900">{row.tenant_name}</span>
      ),
    },
    {
      key: "room",
      header: "Room / Bed",
      render: (row) => (
        <span className="text-xs text-slate-600">
          Room {row.room_number}
          {row.bed_code ? ` · ${row.bed_code}` : ""}
        </span>
      ),
    },
    {
      key: "meal",
      header: "Meal",
      render: (row) => (
        <span className="font-medium capitalize text-slate-900">{row.meal_type}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.status === "cancelled" ? "neutral" : "info"} dot>
          {row.status === "cancelled" ? "Cancelled" : "Active"}
        </Badge>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => (
        <span className="text-xs text-slate-600">{row.reason ?? "—"}</span>
      ),
    },
    {
      key: "requested",
      header: "Requested At",
      render: (row) => (
        <span className="text-xs text-slate-500">
          {row.created_at ? formatDateTime(row.created_at) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Services" }, { label: "Food & Menu" }]}
        title="Food Menu, Skip Tracking & Ratings"
        subtitle="Manage Monday–Sunday weekly meal slots, control resident visibility, track daily meal skips, and review feedback."
        badge={
          <Badge tone={published ? "success" : "warning"} dot>
            {published ? "Published to Residents" : "Draft (Unpublished)"}
          </Badge>
        }
        actions={
          <>
            <Button
              size="sm"
              variant={published ? "outline" : "primary"}
              onClick={() => {
                setDesiredPublishState(!published);
                setPublishConfirmOpen(true);
              }}
            >
              <Globe className="h-4 w-4" />
              <span>{published ? "Unpublish Menu" : "Publish Weekly Menu"}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={loadFood}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
          </>
        }
      />

      {/* Segmented Tabs */}
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("menu")}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
            activeTab === "menu"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <UtensilsCrossed className="h-4 w-4" />
          <span>Weekly Menu Editor</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("skips")}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
            activeTab === "skips"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <CalendarOff className="h-4 w-4" />
          <span>Meal Skip Requests</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ratings")}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
            activeTab === "ratings"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Star className="h-4 w-4" />
          <span>Meal Ratings &amp; Feedback</span>
        </button>
      </div>

      {/* TAB 1: Weekly Menu Editor */}
      {activeTab === "menu" ? (
        <Card>
          <CardHeader
            title="Monday – Sunday Menu Configuration"
            subtitle="Choose any day to configure dishes, dietary tags, upload meal photos, or toggle service availability"
          />
          <CardBody className="space-y-5">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => {
                const active = selectedDay === d.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setSelectedDay(d.key)}
                    className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
                      active
                        ? "bg-navy-900 text-white shadow-sm"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="sm:hidden">{d.short}</span>
                    <span className="hidden sm:inline">{d.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {MEALS.map(({ key, label, defaultTiming }) => {
                const slot = daySlots.find((s) => s.meal_type === key);
                return (
                  <Card
                    key={key}
                    className="flex flex-col justify-between bg-slate-50/50 p-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                            {label}
                          </p>
                          <h3 className="text-sm font-semibold text-slate-900">
                            {slot?.meal_name || `${label} (Unconfigured)`}
                          </h3>
                        </div>
                        {slot ? (
                          <Badge tone={slot.is_available !== false ? "success" : "warning"} dot>
                            {slot.is_available !== false ? "Available" : "Unavailable"}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Not Set</Badge>
                        )}
                      </div>

                      {slot?.image_url ? (
                        <AuthImage
                          src={slot.image_url}
                          alt={slot.meal_name ?? label}
                          className="h-36 w-full rounded-xl object-cover"
                        />
                      ) : null}

                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span>{slot?.timing_label ?? defaultTiming}</span>
                      </div>

                      {slot?.description ? (
                        <p className="text-xs text-slate-600">{slot.description}</p>
                      ) : null}

                      {slot ? (
                        <div className="flex flex-wrap gap-1.5">
                          {slot.menu_items && slot.menu_items.length > 0 ? (
                            slot.menu_items.map((it) => (
                              <span
                                key={it.id}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-800"
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    it.is_veg ? "bg-emerald-600" : "bg-rose-600"
                                  }`}
                                />
                                {it.item_name}
                              </span>
                            ))
                          ) : (
                            <p className="text-xs font-medium text-slate-800">
                              {slot.items_description}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">
                          Click below to add dishes for this slot.
                        </p>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant={slot ? "outline" : "primary"}
                      className="mt-4 w-full"
                      onClick={() => openEditMealModal(selectedDay, key, slot)}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{slot ? "Edit Meal Slot" : "Configure Meal"}</span>
                    </Button>
                  </Card>
                );
              })}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* TAB 2: Meal Skip Requests */}
      {activeTab === "skips" ? (
        <div className="space-y-6">
          <Card>
            <CardBody className="flex flex-wrap items-end justify-between gap-4 p-4">
              <div className="w-full sm:w-64">
                <FieldLabel htmlFor="skip-filter-date" label="Inspect Date" />
                <Input
                  id="skip-filter-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
              {overview.cutoff_times ? (
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900">Active Cutoffs: </span>
                  Breakfast {overview.cutoff_times.breakfast ?? "07:00"} · Lunch{" "}
                  {overview.cutoff_times.lunch ?? "10:30"} · Dinner{" "}
                  {overview.cutoff_times.dinner ?? "17:30"}
                </div>
              ) : null}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {MEALS.map(({ key, label }) => (
              <StatCard
                key={key}
                label={`Active ${label} Skips (${formatDate(overview.target_date)})`}
                value={overview.skip_counts[key] ?? 0}
                icon={CalendarOff}
                tone="blue"
              />
            ))}
          </div>

          <Card>
            <CardHeader
              title="Resident Meal Skip Requests"
              subtitle={`All submitted skip entries for ${formatDate(overview.target_date)}`}
            />
            <DataTable
              columns={skipColumns}
              data={overview.skip_details}
              rowKey={(r) => r.id}
              emptyState={
                <div className="p-5">
                  <EmptyState
                    icon={<CalendarOff className="h-5 w-5" />}
                    title="No meal skips for this date"
                    description="All residents are currently counted for meals on this date."
                  />
                </div>
              }
            />
          </Card>
        </div>
      ) : null}

      {/* TAB 3: Meal Ratings & Feedback */}
      {activeTab === "ratings" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {MEALS.map(({ key, label }) => {
              const avg = overview.average_ratings[key];
              const cnt = overview.rating_counts?.[key] ?? 0;
              return (
                <StatCard
                  key={key}
                  label={`Average ${label} Rating`}
                  value={avg !== null && avg !== undefined ? `${avg} / 5` : "—"}
                  sublabel={`${cnt} ${cnt === 1 ? "rating" : "ratings"}`}
                  icon={Star}
                  tone="amber"
                />
              );
            })}
          </div>

          <Card>
            <CardHeader
              title="Resident Meal Feedback"
              subtitle="Submitted ratings and comments without exposing private resident contact details"
            />
            <CardBody>
              {overview.recent_ratings.length === 0 ? (
                <EmptyState
                  icon={<Star className="h-5 w-5" />}
                  title="No meal ratings yet"
                  description="Resident ratings and food quality comments will appear here once submitted."
                />
              ) : (
                <div className="space-y-3">
                  {overview.recent_ratings.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">
                            {r.tenant_name}
                          </span>
                          {r.room_number ? (
                            <span className="text-slate-500">· Room {r.room_number}</span>
                          ) : null}
                          <Badge tone="info" className="capitalize">
                            {r.meal_type}
                          </Badge>
                          <span className="text-slate-400">
                            {formatDate(r.meal_date)}
                          </span>
                        </div>
                        <div className="inline-flex items-center gap-1 font-bold text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <span>{r.rating}/5</span>
                        </div>
                      </div>
                      {r.comment ? (
                        <p className="mt-1.5 text-slate-700">{r.comment}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Add / Edit Meal Slot Modal */}
      <Modal
        open={editOpen}
        onClose={() => !savingMeal && setEditOpen(false)}
        title={`Configure ${editDay.charAt(0).toUpperCase() + editDay.slice(1)} ${editMeal.charAt(0).toUpperCase() + editMeal.slice(1)}`}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSaveMeal} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="meal-name" label="Meal Name" required />
              <Input
                id="meal-name"
                value={mealName}
                onChange={(e) => setMealName(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="meal-timing" label="Serving Timing" required />
              <Input
                id="meal-timing"
                value={timingLabel}
                onChange={(e) => setTimingLabel(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="meal-desc" label="Food Description (Optional)" />
            <Textarea
              id="meal-desc"
              placeholder="Highlights or dietary notes..."
              value={mealDescription}
              onChange={(e) => setMealDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
            <FieldLabel label="Menu Items" required />
            <div className="space-y-2">
              {dishItems.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={it.item_name}
                    placeholder="Dish name"
                    onChange={(e) => {
                      const val = e.target.value;
                      setDishItems((prev) =>
                        prev.map((row, rIdx) =>
                          rIdx === idx ? { ...row, item_name: val } : row
                        )
                      );
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDishItems((prev) =>
                        prev.map((row, rIdx) =>
                          rIdx === idx ? { ...row, is_veg: !row.is_veg } : row
                        )
                      )
                    }
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                      it.is_veg
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {it.is_veg ? "Veg" : "Non-Veg"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDishItems((prev) => prev.filter((_, rIdx) => rIdx !== idx))
                    }
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-rose-600"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Input
                placeholder="Add another dish item..."
                value={newDishName}
                onChange={(e) => setNewDishName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddDishItem();
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setNewDishVeg((v) => !v)}
                className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                  newDishVeg
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {newDishVeg ? "Veg" : "Non-Veg"}
              </button>
              <Button type="button" size="sm" variant="outline" onClick={handleAddDishItem}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="meal-img" label="Optional Meal Photo" />
              <label
                htmlFor="meal-img"
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 hover:border-brand-400"
              >
                <ImagePlus className="h-4 w-4 text-brand-600" />
                <span className="truncate">
                  {mealImageFile ? mealImageFile.name : "Upload photo (JPG/PNG)"}
                </span>
                <input
                  id="meal-img"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => setMealImageFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                <span>Meal Available for Service</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={savingMeal}
            >
              Cancel
            </Button>
            <Button type="submit" loading={savingMeal}>
              <CheckCircle2 className="h-4 w-4" />
              <span>Save Meal Slot</span>
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={publishConfirmOpen}
        onClose={() => setPublishConfirmOpen(false)}
        onConfirm={handleConfirmPublish}
        title={desiredPublishState ? "Publish Weekly Food Menu" : "Unpublish Weekly Food Menu"}
        description={
          desiredPublishState
            ? "Make all configured Monday–Sunday meal slots visible to residents in the Tenant Portal?"
            : "Hide the weekly food menu from tenants while you finish updating meals?"
        }
        confirmLabel={desiredPublishState ? "Publish Menu" : "Unpublish"}
        destructive={!desiredPublishState}
        loading={publishing}
      />
    </div>
  );
}
