import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { DevOtpBanner } from "@/components/shared/DevOtpBanner";
import { useToast } from "@/components/shared/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { useCountdown } from "@/hooks/useCountdown";
import { AuthShellLayout } from "@/layouts/AuthShellLayout";
import { validateMobileInput } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import { fetchRegistrationOptions } from "@/services/authService";
import { AuthUser, PublicPGOption } from "@/types/api";

type Step = "details" | "otp" | "success";

export function TenantRegisterPage() {
  const [searchParams] = useSearchParams();
  const { authConfig, requestRegistrationOtp, completeTenantRegistration } =
    useAuth();
  const { showToast } = useToast();
  const cooldown = useCountdown(0);

  const [step, setStep] = useState<Step>("details");
  const [pgOptions, setPgOptions] = useState<PublicPGOption[]>([]);
  const [pgId, setPgId] = useState<number | "">("");

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState(() => searchParams.get("mobile") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [otpCode, setOtpCode] = useState("");
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [otpExpiresSeconds, setOtpExpiresSeconds] = useState<number>(300);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicateAccountWarning, setDuplicateAccountWarning] = useState(false);
  const [createdUser, setCreatedUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const paramMobile = searchParams.get("mobile");
    if (paramMobile) setMobile(paramMobile);
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;
    fetchRegistrationOptions()
      .then((opts) => {
        if (!mounted) return;
        setPgOptions(opts);
        if (opts.length >= 1) {
          setPgId(opts[0].id);
        }
      })
      .catch(() => {
        // Non-fatal if PG list is empty or temporarily unreachable
      });
    return () => {
      mounted = false;
    };
  }, []);

  function validateDetailsForm(): boolean {
    if (fullName.trim().length < 2) {
      setErrorMessage("Please enter your full name (at least 2 characters).");
      return false;
    }
    const mobileErr = validateMobileInput(mobile);
    if (mobileErr) {
      setErrorMessage(mobileErr);
      return false;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMessage("Please enter a valid email address or leave it blank.");
      return false;
    }
    if (pgOptions.length > 1 && !pgId) {
      setErrorMessage("Please select the PG property you want to join.");
      return false;
    }
    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return false;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match. Please re-enter carefully.");
      return false;
    }
    return true;
  }

  async function handleRequestRegistrationOtp(e?: FormEvent) {
    if (e) e.preventDefault();
    setErrorMessage(null);
    setDuplicateAccountWarning(false);

    if (!validateDetailsForm()) return;

    setSubmitting(true);
    try {
      const res = await requestRegistrationOtp(mobile.trim());
      setDevOtpPreview(res.dev_otp);
      setOtpExpiresSeconds(res.expires_in_seconds);
      setOtpCode("");
      setStep("otp");
      cooldown.start(
        res.cooldown_seconds ?? authConfig?.otp_resend_cooldown_seconds ?? 30
      );
      showToast(
        "info",
        res.dev_otp ? `Development OTP: ${res.dev_otp}` : "Verification OTP Sent",
        res.dev_otp
          ? `Enter this OTP to complete registration (Valid ${Math.max(
              1,
              Math.round(res.expires_in_seconds / 60)
            )} min).`
          : res.message
      );
    } catch (err) {
      const msg = extractApiError(err);
      setErrorMessage(msg);
      if (msg.toLowerCase().includes("already exists")) {
        setDuplicateAccountWarning(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteRegistration(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setDuplicateAccountWarning(false);

    if (otpCode.trim().length < 4) {
      setErrorMessage("Please enter the verification OTP sent to your mobile.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await completeTenantRegistration({
        full_name: fullName.trim(),
        mobile: mobile.trim(),
        email: email.trim() || undefined,
        password,
        otp: otpCode.trim(),
        pg_id: pgId === "" ? undefined : Number(pgId),
      });
      setCreatedUser(res.user);
      setStep("success");
      showToast(
        "success",
        "Account Created",
        "Mobile verified and tenant account activated."
      );
    } catch (err) {
      const msg = extractApiError(err);
      setErrorMessage(msg);
      if (msg.toLowerCase().includes("already exists")) {
        setDuplicateAccountWarning(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const selectedPg = pgOptions.find((p) => p.id === Number(pgId));

  return (
    <AuthShellLayout
      activeTab="register"
      devOtpMode={authConfig?.dev_otp_mode}
      title="Register as Tenant"
      subtitle="Verify your mobile number via OTP to activate your resident account."
    >
      <div className="space-y-5">
        {/* Strict Tenant-Only Security Notice */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>Self-registration creates a Tenant account only.</span>
          </div>
          <Badge tone="neutral" className="uppercase">
            Tenant
          </Badge>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-3 gap-1.5 text-[11px] font-medium">
          {[
            { key: "details", label: "1. Details" },
            { key: "otp", label: "2. Verify OTP" },
            { key: "success", label: "3. Ready" },
          ].map((item, idx) => {
            const currentIdx = step === "details" ? 0 : step === "otp" ? 1 : 2;
            const active = idx === currentIdx;
            const done = idx < currentIdx;
            return (
              <div
                key={item.key}
                className={`rounded-lg border px-2.5 py-1.5 text-center transition-colors ${
                  active
                    ? "border-navy-900 bg-navy-900 text-white"
                    : done
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-400"
                }`}
              >
                {item.label}
              </div>
            );
          })}
        </div>

        {errorMessage ? (
          <div className="space-y-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-800">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
            {duplicateAccountWarning ? (
              <Link
                to={`/login?mobile=${encodeURIComponent(mobile.trim())}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-900 shadow-xs ring-1 ring-rose-200 transition-colors hover:bg-slate-50"
              >
                <span>Proceed to Sign In</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        ) : null}

        {step === "details" ? (
          <form onSubmit={handleRequestRegistrationOtp} className="space-y-4">
            <div>
              <FieldLabel htmlFor="reg-name" label="Full Name" required />
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="reg-name"
                  type="text"
                  placeholder="e.g. Aarav Mehta"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="reg-mobile" label="Mobile Number" required />
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="reg-mobile"
                  type="tel"
                  placeholder="10-digit mobile e.g. 9876543210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div>
              <FieldLabel
                htmlFor="reg-email"
                label="Email Address"
                hint="Optional"
              />
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {pgOptions.length > 1 ? (
              <div>
                <FieldLabel htmlFor="reg-pg" label="PG Property" required />
                <Select
                  id="reg-pg"
                  value={String(pgId)}
                  onChange={(e) =>
                    setPgId(e.target.value ? Number(e.target.value) : "")
                  }
                  required
                >
                  <option value="">Select PG Property...</option>
                  {pgOptions.map((pg) => (
                    <option key={pg.id} value={pg.id}>
                      {pg.name} ({pg.city})
                    </option>
                  ))}
                </Select>
              </div>
            ) : selectedPg ? (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <Building2 className="h-3.5 w-3.5 text-brand-600" />
                  <span className="font-medium text-slate-900">{selectedPg.name}</span>
                  {selectedPg.city ? (
                    <span className="text-slate-400">· {selectedPg.city}</span>
                  ) : null}
                </div>
                <span className="text-[11px] capitalize text-slate-500">
                  {selectedPg.gender_policy} PG
                </span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="reg-password" label="Password" required />
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="reg-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min 6 chars"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-9"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <FieldLabel
                  htmlFor="reg-confirm-password"
                  label="Confirm Password"
                  required
                />
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="reg-confirm-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-9"
                    minLength={6}
                    required
                  />
                </div>
              </div>
            </div>

            <Button type="submit" loading={submitting} className="w-full" size="lg">
              <KeyRound className="h-4 w-4" />
              <span>Request Verification OTP</span>
            </Button>
          </form>
        ) : step === "otp" ? (
          <form onSubmit={handleCompleteRegistration} className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs">
              <div>
                <p className="font-semibold text-slate-900">{fullName.trim()}</p>
                <p className="font-mono text-[11px] text-slate-500">{mobile.trim()}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep("details");
                  setErrorMessage(null);
                }}
                className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
              >
                <ArrowLeft className="h-3 w-3" />
                <span>Edit Details</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-500">
              Your account is not created until mobile OTP verification completes.
            </p>

            {devOtpPreview ? (
              <DevOtpBanner
                otp={devOtpPreview}
                expiresInSeconds={otpExpiresSeconds}
                onUseCode={(code) => setOtpCode(code)}
              />
            ) : null}

            <div>
              <FieldLabel
                htmlFor="reg-otp-code"
                label="Verification OTP Code"
                required
              />
              <Input
                id="reg-otp-code"
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="Enter 6-digit OTP"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                className="text-center font-mono text-base tracking-[0.3em]"
                required
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting || cooldown.secondsLeft > 0}
                onClick={() => void handleRequestRegistrationOtp()}
                className="flex-1"
              >
                {cooldown.secondsLeft > 0
                  ? `Resend in ${cooldown.secondsLeft}s`
                  : "Resend OTP"}
              </Button>
              <Button type="submit" loading={submitting} className="flex-1">
                Verify &amp; Create Account
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/75 p-4 text-xs">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-emerald-900">
                    Tenant Account Created!
                  </p>
                  <p className="leading-relaxed text-emerald-800">
                    Your mobile number is verified and your account is active. You can
                    now sign in with OTP or password.
                  </p>
                </div>
              </div>
            </div>

            {createdUser ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Resident Name</span>
                  <span className="font-semibold text-slate-900">
                    {createdUser.full_name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Mobile</span>
                  <span className="font-mono font-medium text-slate-900">
                    {createdUser.mobile}
                  </span>
                </div>
                {createdUser.email ? (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Email</span>
                    <span className="text-slate-800">{createdUser.email}</span>
                  </div>
                ) : null}
                {createdUser.pg_name ? (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Property</span>
                    <span className="font-medium text-slate-900">
                      {createdUser.pg_name}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-slate-500">Role</span>
                  <Badge tone="success" className="uppercase">
                    {createdUser.role}
                  </Badge>
                </div>
              </div>
            ) : null}

            <Link
              to={`/login${
                createdUser
                  ? `?mobile=${encodeURIComponent(createdUser.mobile)}`
                  : ""
              }`}
              className="block"
            >
              <Button className="w-full" size="lg">
                <span>Proceed to Sign In</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        )}

        {/* Back to Login Helper */}
        {step !== "success" ? (
          <div className="border-t border-slate-100 pt-3 text-center text-xs text-slate-500">
            Already have a PG account?{" "}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Sign In
            </Link>
          </div>
        ) : null}
      </div>
    </AuthShellLayout>
  );
}

