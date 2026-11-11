import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingState } from "@/components/shared/StateHelpers";
import { useToast } from "@/components/shared/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import { listRooms } from "@/services/roomService";
import {
  registerTenant,
  uploadTenantDocument,
} from "@/services/tenantMgmtService";
import {
  BedDetail,
  DocumentType,
  PoliceVerificationStatus,
  RoomDetail,
  TenantCreateResponse,
} from "@/types/api";

const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
const MAX_BYTES = 5 * 1024 * 1024;

function validateDocFile(file: File | null): string | null {
  if (!file) return null;
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTS.some((ext) => lower.endsWith(ext))) {
    return `${file.name}: Allowed types are JPG, PNG, WEBP, or PDF.`;
  }
  if (file.size > MAX_BYTES) {
    return `${file.name}: File must be 5 MB or smaller.`;
  }
  return null;
}

export function TenantRegistrationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const preselectedBedId = searchParams.get("bedId");

  const [rooms, setRooms] = useState<RoomDetail[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [permanentAddress, setPermanentAddress] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedBedId, setSelectedBedId] = useState(preselectedBedId ?? "");
  const [monthlyRent, setMonthlyRent] = useState("7500");
  const [foodCharges, setFoodCharges] = useState("1000");
  const [securityDeposit, setSecurityDeposit] = useState("15000");
  const [joiningDate, setJoiningDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [expectedLeavingDate, setExpectedLeavingDate] = useState("");
  const [policeVerification, setPoliceVerification] =
    useState<PoliceVerificationStatus>("pending");
  const [initialPassword, setInitialPassword] = useState("");
  const [notes, setNotes] = useState("");

  const [idProofFile, setIdProofFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TenantCreateResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoadingRooms(true);
      try {
        const list = await listRooms();
        if (!mounted) return;
        setRooms(list);

        if (preselectedBedId) {
          for (const r of list) {
            const found = r.beds.find((b) => String(b.id) === preselectedBedId);
            if (found) {
              setSelectedRoomId(String(r.id));
              setSelectedBedId(String(found.id));
              setMonthlyRent(String(parseFloat(found.monthly_rent)));
              setFoodCharges(String(parseFloat(found.food_charges) || 1000));
              break;
            }
          }
        } else {
          const roomWithVacant = list.find((r) => r.vacant_beds > 0) ?? list[0];
          if (roomWithVacant) {
            setSelectedRoomId(String(roomWithVacant.id));
            const firstVacant = roomWithVacant.beds.find((b) => b.status === "vacant");
            if (firstVacant) {
              setSelectedBedId(String(firstVacant.id));
              setMonthlyRent(String(parseFloat(firstVacant.monthly_rent)));
              setFoodCharges(String(parseFloat(firstVacant.food_charges) || 1000));
            }
          }
        }
      } catch (err) {
        showToast("error", "Failed to load rooms", extractApiError(err));
      } finally {
        if (mounted) setLoadingRooms(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [preselectedBedId, showToast]);

  const currentRoom = rooms.find((r) => String(r.id) === selectedRoomId);
  const roomBeds: BedDetail[] = currentRoom?.beds ?? [];

  function handleRoomChange(nextRoomId: string) {
    setSelectedRoomId(nextRoomId);
    const rm = rooms.find((r) => String(r.id) === nextRoomId);
    const firstVacant = rm?.beds.find((b) => b.status === "vacant");
    if (firstVacant) {
      setSelectedBedId(String(firstVacant.id));
      setMonthlyRent(String(parseFloat(firstVacant.monthly_rent)));
      setFoodCharges(String(parseFloat(firstVacant.food_charges) || 1000));
    } else {
      setSelectedBedId("");
    }
  }

  function handleBedChange(nextBedId: string) {
    setSelectedBedId(nextBedId);
    const bed = roomBeds.find((b) => String(b.id) === nextBedId);
    if (bed) {
      setMonthlyRent(String(parseFloat(bed.monthly_rent)));
      if (parseFloat(bed.food_charges) > 0) {
        setFoodCharges(String(parseFloat(bed.food_charges)));
      }
    }
  }

  function onSelectFile(
    setter: (f: File | null) => void,
    e: ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0] ?? null;
    const err = validateDocFile(file);
    if (err) {
      showToast("error", "Invalid File", err);
      e.target.value = "";
      return;
    }
    setter(file);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedBedId) {
      showToast("error", "Bed Required", "Please select a vacant bed.");
      return;
    }

    const fileErrors = [
      validateDocFile(idProofFile),
      validateDocFile(photoFile),
      validateDocFile(agreementFile),
    ].filter(Boolean);
    if (fileErrors.length > 0) {
      showToast("error", "Invalid Document", String(fileErrors[0]));
      return;
    }

    setSubmitting(true);
    try {
      const created = await registerTenant({
        full_name: fullName,
        mobile,
        email: email.trim() || undefined,
        gender: gender || undefined,
        date_of_birth: dob || undefined,
        permanent_address: permanentAddress.trim() || undefined,
        bed_id: Number(selectedBedId),
        monthly_rent: monthlyRent,
        food_charges: foodCharges,
        security_deposit_amount: securityDeposit,
        joining_date: joiningDate,
        expected_leaving_date: expectedLeavingDate || undefined,
        emergency_contact_name: emergencyName,
        emergency_contact_phone: emergencyPhone,
        police_verification_status: policeVerification,
        password: initialPassword.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      const docUploads: { type: DocumentType; file: File }[] = [];
      if (idProofFile) docUploads.push({ type: "id_proof", file: idProofFile });
      if (photoFile) docUploads.push({ type: "photo", file: photoFile });
      if (agreementFile) docUploads.push({ type: "rental_agreement", file: agreementFile });

      for (const item of docUploads) {
        await uploadTenantDocument(created.tenant.id, item.type, item.file);
      }

      setResult(created);
      showToast(
        "success",
        "Tenant Registered",
        `${created.tenant.full_name} allocated to Bed ${created.tenant.bed_code}.`
      );
    } catch (err) {
      showToast("error", "Registration Failed", extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingRooms) {
    return <LoadingState label="Loading rooms & vacant beds..." />;
  }

  if (result) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardBody className="space-y-5 p-6">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-4">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
            <div>
              <h2 className="text-base font-semibold text-emerald-950">
                Tenant Registered &amp; Bed Occupied
              </h2>
              <p className="mt-1 text-xs text-emerald-800">
                {result.tenant.full_name} has been assigned to Room{" "}
                <strong>{result.tenant.room_number}</strong> · Bed{" "}
                <strong>{result.tenant.bed_code}</strong>.
              </p>
            </div>
          </div>

          <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Tenant Login Mobile</dt>
              <dd className="mt-0.5 font-mono font-semibold text-slate-900">
                {result.tenant.mobile}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Assigned Role</dt>
              <dd className="mt-0.5 font-semibold uppercase text-brand-700">TENANT</dd>
            </div>
            <div>
              <dt className="text-slate-500">Monthly Rent + Food</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                {formatINR(result.tenant.monthly_rent)} +{" "}
                {formatINR(result.tenant.food_charges)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Security Deposit Held</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                {formatINR(result.tenant.security_deposit_amount)}
              </dd>
            </div>
            {result.temporary_password ? (
              <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <dt className="font-semibold text-amber-900">
                  Generated Temporary Login Password (share securely with resident):
                </dt>
                <dd className="mt-1 font-mono text-sm font-bold text-slate-900">
                  {result.temporary_password}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate(`/tenants/${result.tenant.id}`)}>
              View Tenant Profile
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setResult(null);
                setFullName("");
                setMobile("");
                setEmail("");
                setIdProofFile(null);
                setPhotoFile(null);
                setAgreementFile(null);
              }}
            >
              Register Another Tenant
            </Button>
            <Link to="/tenants">
              <Button variant="ghost">Back to Tenant List</Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Operations" },
          { label: "Tenants", to: "/tenants" },
          { label: "Register Resident" },
        ]}
        title="New Tenant Registration"
        subtitle="Onboard a resident, allocate a vacant bed, lock security deposit terms, and upload private KYC documents."
        badge={<Badge tone="info">Property: {user?.pg_name ?? "Assigned PG"}</Badge>}
        actions={
          <Link to="/tenants">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" />
              <span>Tenants</span>
            </Button>
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="1. Personal & Emergency Details"
              subtitle="Resident identity and contact verification"
              action={<UserPlus className="h-4 w-4 text-slate-400" />}
            />
            <CardBody className="space-y-4">
              <div>
                <FieldLabel htmlFor="t-name" label="Full Name" required />
                <Input
                  id="t-name"
                  placeholder="e.g. Rohit Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="t-mob" label="Mobile Number" required />
                  <Input
                    id="t-mob"
                    type="tel"
                    placeholder="10-digit mobile"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="t-email" label="Email Address" hint="Optional" />
                  <Input
                    id="t-email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="t-gender" label="Gender" hint="Optional" />
                  <Select
                    id="t-gender"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor="t-dob" label="Date of Birth" hint="Optional" />
                  <Input
                    id="t-dob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="t-addr" label="Permanent Address" hint="Optional" />
                <Textarea
                  id="t-addr"
                  placeholder="Home address as per Aadhaar/ID..."
                  value={permanentAddress}
                  onChange={(e) => setPermanentAddress(e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="t-ename" label="Emergency Contact Name" required />
                  <Input
                    id="t-ename"
                    placeholder="Parent / Guardian"
                    value={emergencyName}
                    onChange={(e) => setEmergencyName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="t-ephone" label="Emergency Phone" required />
                  <Input
                    id="t-ephone"
                    type="tel"
                    placeholder="10-digit mobile"
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                    required
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="2. Room, Bed & Deposit Terms"
              subtitle="Only vacant beds can be allocated"
              action={<ShieldCheck className="h-4 w-4 text-slate-400" />}
            />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="t-room" label="Room Number" required />
                  <Select
                    id="t-room"
                    value={selectedRoomId}
                    onChange={(e) => handleRoomChange(e.target.value)}
                    required
                  >
                    <option value="">Select Room</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} ({r.vacant_beds} vacant)
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor="t-bed" label="Bed Number" required />
                  <Select
                    id="t-bed"
                    value={selectedBedId}
                    onChange={(e) => handleBedChange(e.target.value)}
                    required
                  >
                    <option value="">Select Vacant Bed</option>
                    {roomBeds.map((b) => (
                      <option
                        key={b.id}
                        value={b.id}
                        disabled={b.status !== "vacant"}
                      >
                        {b.bed_code} — {b.status.toUpperCase()} (
                        {formatINR(b.monthly_rent)})
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <FieldLabel htmlFor="t-rent" label="Monthly Rent (₹)" required />
                  <Input
                    id="t-rent"
                    type="number"
                    min={0}
                    step="0.01"
                    value={monthlyRent}
                    onChange={(e) => setMonthlyRent(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="t-food" label="Food Charges (₹)" />
                  <Input
                    id="t-food"
                    type="number"
                    min={0}
                    step="0.01"
                    value={foodCharges}
                    onChange={(e) => setFoodCharges(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="t-dep" label="Security Deposit (₹)" required />
                  <Input
                    id="t-dep"
                    type="number"
                    min={0}
                    step="0.01"
                    value={securityDeposit}
                    onChange={(e) => setSecurityDeposit(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="t-join" label="Joining Date" required />
                  <Input
                    id="t-join"
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <FieldLabel
                    htmlFor="t-exp-leave"
                    label="Expected Leaving Date"
                    hint="Optional"
                  />
                  <Input
                    id="t-exp-leave"
                    type="date"
                    value={expectedLeavingDate}
                    onChange={(e) => setExpectedLeavingDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="t-police" label="Police Verification" required />
                  <Select
                    id="t-police"
                    value={policeVerification}
                    onChange={(e) =>
                      setPoliceVerification(e.target.value as PoliceVerificationStatus)
                    }
                  >
                    <option value="pending">Pending</option>
                    <option value="submitted">Submitted</option>
                    <option value="verified">Verified</option>
                    <option value="not_required">Not Required</option>
                  </Select>
                </div>
                <div>
                  <FieldLabel
                    htmlFor="t-pw"
                    label="Initial Account Password"
                    hint="Auto-generated if blank"
                  />
                  <Input
                    id="t-pw"
                    type="password"
                    minLength={6}
                    placeholder="Optional (min 6 chars)"
                    value={initialPassword}
                    onChange={(e) => setInitialPassword(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="t-notes" label="Notes" hint="Optional" />
                <Input
                  id="t-notes"
                  placeholder="Any special terms or remarks..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="3. KYC & Agreement Documents (Private Storage)"
            subtitle="JPG, PNG, WEBP, or PDF up to 5 MB each. Access-controlled strictly for authorized PG staff and owning tenant."
            action={<FileUp className="h-4 w-4 text-slate-400" />}
          />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel htmlFor="doc-id" label="Government ID Proof" />
                <input
                  id="doc-id"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => onSelectFile(setIdProofFile, e)}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-blue-100"
                />
              </div>
              <div>
                <FieldLabel htmlFor="doc-photo" label="Tenant Photograph" />
                <input
                  id="doc-photo"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={(e) => onSelectFile(setPhotoFile, e)}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-blue-100"
                />
              </div>
              <div>
                <FieldLabel htmlFor="doc-agree" label="Rental Agreement" />
                <input
                  id="doc-agree"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => onSelectFile(setAgreementFile, e)}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-blue-100"
                />
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="flex justify-end gap-3">
          <Link to="/tenants">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <Button type="submit" size="lg" loading={submitting}>
            Register Tenant &amp; Allocate Bed
          </Button>
        </div>
      </form>
    </div>
  );
}
