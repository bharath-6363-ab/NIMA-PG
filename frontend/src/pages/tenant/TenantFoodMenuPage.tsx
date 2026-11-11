import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarOff,
  CheckCircle2,
  Clock,
  Coffee,
  RefreshCw,
  Star,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { AuthImage } from "@/components/shared/AuthImage";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/StateHelpers";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  cancelMealSkip,
  fetchTenantFoodOverview,
  submitMealRating,
  submitMealSkip,
} from "@/services/foodService";
import {
  DayOfWeek,
  MealSkipItem,
  MealType,
  TenantFoodOverview,
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

const MEALS: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

function getTodayDayKey(): DayOfWeek {
  const map: DayOfWeek[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return map[new Date().getDay()];
}

function getTomorrowISO(): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export function TenantFoodMenuPage() {
  const { showToast } = useToast();
  const todayISO = new Date().toISOString().slice(0, 10);

  const [overview, setOverview] = useState<TenantFoodOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(getTodayDayKey());

  // Meal skip form
  const [skipDate, setSkipDate] = useState<string>(getTomorrowISO());
  const [skipMeal, setSkipMeal] = useState<MealType>("lunch");
  const [skipReason, setSkipReason] = useState("");
  const [submittingSkip, setSubmittingSkip] = useState(false);

  // Cancel confirmation dialog
  const [cancelTarget, setCancelTarget] = useState<MealSkipItem | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Meal rating form
  const [rateDate, setRateDate] = useState<string>(todayISO);
  const [rateMeal, setRateMeal] = useState<MealType>("lunch");
  const [rateStars, setRateStars] = useState<number>(4);
  const [rateComment, setRateComment] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);

  const loadFoodOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTenantFoodOverview();
      setOverview(data);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFoodOverview();
  }, [loadFoodOverview]);

  const dayMenuSlots = useMemo(() => {
    if (!overview) return [];
    return overview.weekly_menu.filter((s) => s.day_of_week === selectedDay);
  }, [overview, selectedDay]);

  useEffect(() => {
    if (!overview) return;
    const match = overview.my_ratings.find(
      (r) => r.meal_date === rateDate && r.meal_type === rateMeal
    );
    if (match) {
      setRateStars(match.rating);
      setRateComment(match.comment ?? "");
    }
  }, [overview, rateDate, rateMeal]);

  async function handleSubmitSkip(e: FormEvent) {
    e.preventDefault();
    setSubmittingSkip(true);
    try {
      await submitMealSkip({
        skip_date: skipDate,
        meal_type: skipMeal,
        reason: skipReason.trim() || undefined,
      });
      showToast(
        "success",
        "Meal skip recorded",
        `${skipMeal.toUpperCase()} marked skipped for ${formatDate(skipDate)}.`
      );
      setSkipReason("");
      await loadFoodOverview();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSubmittingSkip(false);
    }
  }

  async function handleConfirmCancelSkip() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelMealSkip(cancelTarget.id);
      showToast("info", "Meal skip request cancelled.");
      setCancelTarget(null);
      await loadFoodOverview();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setCancelling(false);
    }
  }

  async function handleSubmitRating(e: FormEvent) {
    e.preventDefault();
    setSubmittingRating(true);
    try {
      await submitMealRating({
        meal_date: rateDate,
        meal_type: rateMeal,
        rating: rateStars,
        comment: rateComment.trim() || undefined,
      });
      showToast("success", "Meal feedback saved.");
      await loadFoodOverview();
    } catch (err) {
      showToast("error", extractApiError(err));
    } finally {
      setSubmittingRating(false);
    }
  }

  if (loading && !overview) {
    return <DashboardSkeleton />;
  }

  if (error || !overview) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
        title="Unable to load food menu"
        description={error ?? "Please try again in a moment."}
        action={<Button onClick={loadFoodOverview}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Resident Portal", to: "/tenant" },
          { label: "Food Menu & Skips" },
        ]}
        title="Weekly Food Menu & Meal Preferences"
        subtitle="Browse the published Monday–Sunday menu, submit meal skips before kitchen cutoff, and share meal ratings."
        actions={
          <Button variant="outline" size="sm" onClick={loadFoodOverview}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Weekly Meal Schedule (Monday – Sunday)"
          subtitle="Select a day to inspect meal timings, dish items, and kitchen availability"
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

          {overview.weekly_menu.length === 0 ? (
            <EmptyState
              icon={<UtensilsCrossed className="h-5 w-5" />}
              title="Weekly menu is currently being updated"
              description="Your PG Manager has not published this week's menu yet. Check back shortly."
            />
          ) : dayMenuSlots.length === 0 ? (
            <EmptyState
              icon={<Coffee className="h-5 w-5" />}
              title={`No meals published for ${selectedDay}`}
              description="Try choosing another day of the week above."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {MEALS.map(({ key, label }) => {
                const slot = dayMenuSlots.find((s) => s.meal_type === key);
                return (
                  <Card
                    key={key}
                    className="flex flex-col justify-between bg-slate-50/50 p-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
                            {label}
                          </p>
                          <h3 className="text-sm font-semibold text-slate-900">
                            {slot?.meal_name || `${label} Menu`}
                          </h3>
                        </div>
                        {slot ? (
                          <Badge tone={slot.is_available !== false ? "success" : "warning"} dot>
                            {slot.is_available !== false ? "Available" : "Unavailable"}
                          </Badge>
                        ) : null}
                      </div>

                      {slot?.image_url ? (
                        <AuthImage
                          src={slot.image_url}
                          alt={slot.meal_name ?? label}
                          className="h-36 w-full rounded-xl object-cover"
                        />
                      ) : null}

                      {slot ? (
                        <>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            <span>{slot.timing_label}</span>
                          </div>
                          {slot.description ? (
                            <p className="text-xs text-slate-600">{slot.description}</p>
                          ) : null}
                          <div className="flex flex-wrap gap-1.5">
                            {slot.menu_items && slot.menu_items.length > 0 ? (
                              slot.menu_items.map((item) => (
                                <span
                                  key={item.id}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-800"
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      item.is_veg ? "bg-emerald-600" : "bg-rose-600"
                                    }`}
                                  />
                                  {item.item_name}
                                </span>
                              ))
                            ) : (
                              <p className="text-xs font-medium text-slate-800">
                                {slot.items_description}
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400">
                          Not configured for this day.
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Meal Skip Request"
            subtitle="Inform the kitchen when dining out (tracking only; monthly food charges remain unchanged)"
          />
          <CardBody className="space-y-5">
            {overview.cutoff_times ? (
              <div className="rounded-xl border border-brand-200/70 bg-brand-50/50 px-3.5 py-2.5 text-[11px] text-slate-800">
                <span className="font-semibold">Same-day Cutoff Times: </span>
                Breakfast {overview.cutoff_times.breakfast ?? "07:00"} · Lunch{" "}
                {overview.cutoff_times.lunch ?? "10:30"} · Dinner{" "}
                {overview.cutoff_times.dinner ?? "17:30"}
              </div>
            ) : null}

            <form onSubmit={handleSubmitSkip} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="skip-date" label="Meal Date" required />
                  <Input
                    id="skip-date"
                    type="date"
                    min={todayISO}
                    value={skipDate}
                    onChange={(e) => setSkipDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="skip-meal" label="Meal Slot" required />
                  <Select
                    id="skip-meal"
                    value={skipMeal}
                    onChange={(e) => setSkipMeal(e.target.value as MealType)}
                  >
                    {MEALS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="skip-reason" label="Optional Reason" />
                <Input
                  id="skip-reason"
                  placeholder="e.g., Travelling home or team dinner"
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  maxLength={255}
                />
              </div>
              <Button type="submit" loading={submittingSkip} className="w-full">
                <CalendarOff className="h-4 w-4" />
                <span>Submit Meal Skip Request</span>
              </Button>
            </form>

            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-slate-900">
                My Submitted Skip Requests
              </p>
              {overview.my_skips.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No meal skip requests submitted yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {overview.my_skips.map((sk) => (
                    <div
                      key={sk.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <span>{formatDate(sk.skip_date)}</span>
                          <span className="capitalize">· {sk.meal_type}</span>
                          <Badge tone={sk.status === "active" ? "info" : "neutral"} dot>
                            {sk.status === "active" ? "Active" : "Cancelled"}
                          </Badge>
                        </div>
                        {sk.reason ? (
                          <p className="mt-0.5 text-[11px] text-slate-500">{sk.reason}</p>
                        ) : null}
                      </div>

                      {sk.can_cancel ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCancelTarget(sk)}
                        >
                          <XCircle className="h-3.5 w-3.5 text-rose-600" />
                          <span>Cancel</span>
                        </Button>
                      ) : sk.status === "active" ? (
                        <span className="text-[11px] text-slate-400">
                          Cutoff passed
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Rate Meals & Share Feedback"
            subtitle="Help the kitchen improve quality; you can update a past meal rating anytime"
          />
          <CardBody className="space-y-5">
            <form onSubmit={handleSubmitRating} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="rate-date" label="Meal Date" required />
                  <Input
                    id="rate-date"
                    type="date"
                    max={todayISO}
                    value={rateDate}
                    onChange={(e) => setRateDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="rate-meal" label="Meal Slot" required />
                  <Select
                    id="rate-meal"
                    value={rateMeal}
                    onChange={(e) => setRateMeal(e.target.value as MealType)}
                  >
                    {MEALS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <FieldLabel label="Star Rating (1–5)" required />
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRateStars(star)}
                      className="rounded p-1 transition-transform hover:scale-110"
                      aria-label={`Rate ${star} stars`}
                    >
                      <Star
                        className={`h-5 w-5 ${
                          star <= rateStars
                            ? "fill-amber-400 text-amber-400"
                            : "text-slate-300"
                        }`}
                      />
                    </button>
                  ))}
                  <span className="ml-2 text-xs font-semibold text-slate-900">
                    {rateStars} / 5
                  </span>
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="rate-comment" label="Feedback Comment" />
                <Textarea
                  id="rate-comment"
                  placeholder="Share taste, portion size, or hygiene suggestions..."
                  value={rateComment}
                  onChange={(e) => setRateComment(e.target.value)}
                  maxLength={1000}
                />
              </div>

              <Button type="submit" loading={submittingRating} className="w-full">
                <CheckCircle2 className="h-4 w-4" />
                <span>Save Meal Rating</span>
              </Button>
            </form>

            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-slate-900">
                My Recent Meal Ratings
              </p>
              {overview.my_ratings.length === 0 ? (
                <p className="text-xs text-slate-500">No meal ratings submitted yet.</p>
              ) : (
                <div className="space-y-2">
                  {overview.my_ratings.slice(0, 8).map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold capitalize text-slate-900">
                          {formatDate(r.meal_date)} · {r.meal_type}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          {r.rating}/5
                        </span>
                      </div>
                      {r.comment ? (
                        <p className="mt-0.5 text-[11px] text-slate-600">{r.comment}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancelSkip}
        title="Cancel Meal Skip Request"
        description={
          cancelTarget
            ? `Are you sure you want to cancel your skip request for ${cancelTarget.meal_type} on ${formatDate(cancelTarget.skip_date)}? The kitchen will include you in the meal count.`
            : ""
        }
        confirmLabel="Yes, Cancel Skip"
        destructive
        loading={cancelling}
      />
    </div>
  );
}
