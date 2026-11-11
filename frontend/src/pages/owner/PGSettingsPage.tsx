import { FormEvent, useCallback, useEffect, useState } from "react";
import { Building2, Clock, IndianRupee, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/shared/ToastProvider";
import { extractApiError } from "@/services/apiClient";
import {
  fetchOwnerPgSettings,
  fetchVacancyOverview,
  updateOwnerPgSettings,
} from "@/services/ownerService";
import { PGSettings, PropertySummary } from "@/types/api";

type SettingsFormState = {
  name: string;
  city: string;
  address: string;
  gender_policy: "coed" | "male" | "female";
  rent_due_day: string;
  default_monthly_rent: string;
  default_food_charges: string;
  default_security_deposit: string;
  breakfast_timing: string;
  lunch_timing: string;
  dinner_timing: string;
  amenities: string;
};

function toFormState(data: PGSettings): SettingsFormState {
  return {
    name: data.name ?? "",
    city: data.city ?? "",
    address: data.address ?? "",
    gender_policy: data.gender_policy ?? "coed",
    rent_due_day: String(data.rent_due_day ?? 5),
    default_monthly_rent: data.default_monthly_rent ?? "0.00",
    default_food_charges: data.default_food_charges ?? "0.00",
    default_security_deposit: data.default_security_deposit ?? "0.00",
    breakfast_timing: data.breakfast_timing ?? "",
    lunch_timing: data.lunch_timing ?? "",
    dinner_timing: data.dinner_timing ?? "",
    amenities: data.amenities ?? "",
  };
}

export function PGSettingsPage() {
  const { showToast } = useToast();
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [selectedPgId, setSelectedPgId] = useState<number | undefined>(undefined);
  const [savedSettings, setSavedSettings] = useState<PGSettings | null>(null);
  const [form, setForm] = useState<SettingsFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async (pgId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const [settingsData, vacancyData] = await Promise.all([
        fetchOwnerPgSettings(pgId),
        fetchVacancyOverview(pgId ? { pg_id: pgId } : undefined),
      ]);
      setSavedSettings(settingsData);
      setForm(toFormState(settingsData));
      setSelectedPgId(settingsData.id);
      setProperties(vacancyData.properties ?? []);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handlePropertySwitch = (nextPgId: number) => {
    setSelectedPgId(nextPgId);
    void loadSettings(nextPgId);
  };

  const handleReset = () => {
    if (savedSettings) {
      setForm(toFormState(savedSettings));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;

    const trimmedName = form.name.trim();
    if (trimmedName.length < 2) {
      showToast("error", "Validation error", "Property name must be at least 2 characters.");
      return;
    }

    const dueDay = Number(form.rent_due_day);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
      showToast("error", "Validation error", "Rent due day must be an integer between 1 and 28.");
      return;
    }

    const defaultRent = Number(form.default_monthly_rent);
    const defaultFood = Number(form.default_food_charges);
    const defaultDeposit = Number(form.default_security_deposit);
    if (
      Number.isNaN(defaultRent) ||
      defaultRent < 0 ||
      Number.isNaN(defaultFood) ||
      defaultFood < 0 ||
      Number.isNaN(defaultDeposit) ||
      defaultDeposit < 0
    ) {
      showToast("error", "Validation error", "Default monetary amounts cannot be negative.");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateOwnerPgSettings(
        {
          name: trimmedName,
          city: form.city.trim(),
          address: form.address.trim(),
          gender_policy: form.gender_policy,
          rent_due_day: dueDay,
          default_monthly_rent: defaultRent,
          default_food_charges: defaultFood,
          default_security_deposit: defaultDeposit,
          breakfast_timing: form.breakfast_timing.trim(),
          lunch_timing: form.lunch_timing.trim(),
          dinner_timing: form.dinner_timing.trim(),
          amenities: form.amenities.trim(),
        },
        selectedPgId
      );
      setSavedSettings(updated);
      setForm(toFormState(updated));
      setProperties((prev) =>
        prev.map((prop) =>
          prop.id === updated.id
            ? { ...prop, name: updated.name, city: updated.city }
            : prop
        )
      );
      showToast("success", "PG settings saved", `${updated.name} configuration updated.`);
    } catch (err) {
      showToast("error", "Failed to save settings", extractApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !form) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Admin" }, { label: "PG Settings" }]}
        title="PG Property Settings"
        subtitle="Configure property profile, billing due day, default charges, meal timings, and public vacancy amenities."
        actions={
          <>
            {properties.length > 1 ? (
              <Select
                aria-label="Select PG property"
                className="w-56"
                value={selectedPgId ?? ""}
                onChange={(e) => handlePropertySwitch(Number(e.target.value))}
              >
                {properties.map((prop) => (
                  <option key={prop.id} value={prop.id}>
                    {prop.name} {prop.city ? `(${prop.city})` : ""}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadSettings(selectedPgId)}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
          </>
        }
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {form ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader
              title="Property Profile"
              subtitle="General information displayed across public vacancy pages and payment receipts"
              action={<Building2 className="h-4 w-4 text-slate-400" />}
            />
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <FieldLabel htmlFor="pg-name" label="Property Name" required />
                <Input
                  id="pg-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  minLength={2}
                  maxLength={150}
                />
              </div>

              <div>
                <FieldLabel htmlFor="pg-city" label="City" />
                <Input
                  id="pg-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  maxLength={80}
                />
              </div>

              <div>
                <FieldLabel htmlFor="pg-gender" label="Gender Policy" />
                <Select
                  id="pg-gender"
                  value={form.gender_policy}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      gender_policy: e.target.value as "coed" | "male" | "female",
                    })
                  }
                >
                  <option value="coed">Co-ed / Mixed</option>
                  <option value="male">Gents / Boys Only</option>
                  <option value="female">Ladies / Girls Only</option>
                </Select>
              </div>

              <div>
                <FieldLabel htmlFor="pg-address" label="Street Address" />
                <Input
                  id="pg-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>

              <div className="md:col-span-2">
                <FieldLabel
                  htmlFor="pg-amenities"
                  label="Amenities"
                  hint="Comma-separated list shown on public vacancy links"
                />
                <Textarea
                  id="pg-amenities"
                  value={form.amenities}
                  onChange={(e) => setForm({ ...form, amenities: e.target.value })}
                  placeholder="Wi-Fi, Laundry, Housekeeping, CCTV, RO Water, Backup Power"
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Rent & Deposit Defaults"
              subtitle="Used as defaults when creating beds, onboarding tenants, and scheduling rent due dates"
              action={<IndianRupee className="h-4 w-4 text-slate-400" />}
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <FieldLabel htmlFor="pg-due-day" label="Rent Due Day" hint="1 - 28" required />
                <Input
                  id="pg-due-day"
                  type="number"
                  min={1}
                  max={28}
                  value={form.rent_due_day}
                  onChange={(e) => setForm({ ...form, rent_due_day: e.target.value })}
                  required
                />
              </div>

              <div>
                <FieldLabel htmlFor="pg-default-rent" label="Default Monthly Rent (₹)" />
                <Input
                  id="pg-default-rent"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.default_monthly_rent}
                  onChange={(e) => setForm({ ...form, default_monthly_rent: e.target.value })}
                />
              </div>

              <div>
                <FieldLabel htmlFor="pg-default-food" label="Default Food Charges (₹)" />
                <Input
                  id="pg-default-food"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.default_food_charges}
                  onChange={(e) => setForm({ ...form, default_food_charges: e.target.value })}
                />
              </div>

              <div>
                <FieldLabel htmlFor="pg-default-deposit" label="Default Security Deposit (₹)" />
                <Input
                  id="pg-default-deposit"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.default_security_deposit}
                  onChange={(e) =>
                    setForm({ ...form, default_security_deposit: e.target.value })
                  }
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Meal Schedule Timings"
              subtitle="Displayed in the resident food menu portal and public vacancy pages"
              action={<Clock className="h-4 w-4 text-slate-400" />}
            />
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <FieldLabel htmlFor="pg-breakfast" label="Breakfast Timing" />
                <Input
                  id="pg-breakfast"
                  value={form.breakfast_timing}
                  onChange={(e) => setForm({ ...form, breakfast_timing: e.target.value })}
                  placeholder="07:30 AM - 09:30 AM"
                  maxLength={60}
                />
              </div>

              <div>
                <FieldLabel htmlFor="pg-lunch" label="Lunch Timing" />
                <Input
                  id="pg-lunch"
                  value={form.lunch_timing}
                  onChange={(e) => setForm({ ...form, lunch_timing: e.target.value })}
                  placeholder="12:30 PM - 02:30 PM"
                  maxLength={60}
                />
              </div>

              <div>
                <FieldLabel htmlFor="pg-dinner" label="Dinner Timing" />
                <Input
                  id="pg-dinner"
                  value={form.dinner_timing}
                  onChange={(e) => setForm({ ...form, dinner_timing: e.target.value })}
                  placeholder="07:30 PM - 09:30 PM"
                  maxLength={60}
                />
              </div>
            </CardBody>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleReset} disabled={saving}>
              Reset Changes
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              <Save className="h-4 w-4" />
              <span>Save Settings</span>
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
