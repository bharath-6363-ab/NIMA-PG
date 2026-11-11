import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Phone,
  ShieldAlert,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input } from "@/components/ui/Input";
import { DevOtpBanner } from "@/components/shared/DevOtpBanner";
import { useToast } from "@/components/shared/ToastProvider";
import { roleHomePath, useAuth } from "@/context/AuthContext";
import { useCountdown } from "@/hooks/useCountdown";
import { AuthShellLayout } from "@/layouts/AuthShellLayout";
import { validateMobileInput } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import { UserRole } from "@/types/api";

type AuthMode = "otp" | "password";

const PORTAL_OPTIONS: { value: UserRole | "auto"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "tenant", label: "Tenant" },
  { value: "manager", label: "Manager" },
  { value: "owner", label: "Owner" },
];

const DEV_TEST_CREDENTIALS: {
  label: string;
  role: UserRole;
  mobile: string;
  password: string;
}[] = [
  { label: "Owner (Malik)", role: "owner", mobile: "9800000001", password: "Owner@123" },
  { label: "Manager", role: "manager", mobile: "9800000002", password: "Manager@123" },
  { label: "Tenant (Rahul)", role: "tenant", mobile: "9800000003", password: "Tenant@123" },
];

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { authConfig, loginWithPassword, requestOtp, verifyOtp } = useAuth();
  const { showToast } = useToast();
  const cooldown = useCountdown(0);

  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    searchParams.get("mode") === "password" ? "password" : "otp"
  );
  const [portalSelection, setPortalSelection] = useState<UserRole | "auto">("auto");
  const [mobile, setMobile] = useState(() => searchParams.get("mobile") ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [otpExpiresSeconds, setOtpExpiresSeconds] = useState<number>(300);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [suggestRegister, setSuggestRegister] = useState(false);

  useEffect(() => {
    const paramMobile = searchParams.get("mobile");
    if (paramMobile) {
      setMobile(paramMobile);
    }
  }, [searchParams]);

  const selectedPortalRole =
    portalSelection === "auto" ? undefined : portalSelection;

  function validateMobileFormat(raw: string): boolean {
    const err = validateMobileInput(raw);
    if (err) {
      setErrorMessage(err);
      return false;
    }
    return true;
  }

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuggestRegister(false);
    if (!validateMobileFormat(mobile)) return;

    setSubmitting(true);
    try {
      const res = await requestOtp(mobile, selectedPortalRole);
      setOtpRequested(true);
      setDevOtpPreview(res.dev_otp);
      setOtpExpiresSeconds(res.expires_in_seconds);
      setOtpCode("");
      cooldown.start(
        res.cooldown_seconds ?? authConfig?.otp_resend_cooldown_seconds ?? 30
      );
      showToast(
        "info",
        res.dev_otp ? `Development OTP: ${res.dev_otp}` : "OTP Dispatched",
        res.dev_otp
          ? `Valid for ${Math.max(1, Math.round(res.expires_in_seconds / 60))} min (no live SMS sent).`
          : res.message
      );
    } catch (err) {
      const msg = extractApiError(err);
      setErrorMessage(msg);
      if (msg.toLowerCase().includes("no registered account")) {
        setSuggestRegister(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    if (otpCode.trim().length < 4) {
      setErrorMessage("Please enter the verification OTP code.");
      return;
    }
    setSubmitting(true);
    try {
      const loggedInUser = await verifyOtp(mobile, otpCode, selectedPortalRole);
      showToast("success", "Signed in", `Welcome back, ${loggedInUser.full_name}`);
      navigate(roleHomePath(loggedInUser.role), { replace: true });
    } catch (err) {
      setErrorMessage(extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordLogin(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuggestRegister(false);
    if (!validateMobileFormat(mobile)) return;
    if (password.length < 4) {
      setErrorMessage("Please enter your account password.");
      return;
    }
    setSubmitting(true);
    try {
      const loggedInUser = await loginWithPassword(
        mobile,
        password,
        selectedPortalRole
      );
      showToast("success", "Signed in", `Welcome back, ${loggedInUser.full_name}`);
      navigate(roleHomePath(loggedInUser.role), { replace: true });
    } catch (err) {
      const msg = extractApiError(err);
      setErrorMessage(msg);
      if (msg.toLowerCase().includes("no registered account")) {
        setSuggestRegister(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function applyDemoCredential(cred: (typeof DEV_TEST_CREDENTIALS)[number]) {
    setErrorMessage(null);
    setSuggestRegister(false);
    setMobile(cred.mobile);
    setPassword(cred.password);
    setPortalSelection(cred.role);
    setOtpRequested(false);
    setDevOtpPreview(null);
    setOtpCode("");
    cooldown.reset();
  }

  return (
    <AuthShellLayout
      activeTab="login"
      devOtpMode={authConfig?.dev_otp_mode}
      title="Sign in to your account"
      subtitle="Use your registered mobile number with OTP or password."
    >
      <div className="space-y-5">
        {/* Portal Role Filter */}
        <div>
          <FieldLabel
            label="Portal Access"
            hint="Enforced by backend role check"
          />
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100/90 p-1">
            {PORTAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setPortalSelection(opt.value);
                  setErrorMessage(null);
                }}
                className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
                  portalSelection === opt.value
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Auth Method Toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setAuthMode("otp");
              setErrorMessage(null);
              setSuggestRegister(false);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
              authMode === "otp"
                ? "border-navy-900 bg-navy-900 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Mobile + OTP</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode("password");
              setErrorMessage(null);
              setSuggestRegister(false);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
              authMode === "password"
                ? "border-navy-900 bg-navy-900 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Lock className="h-3.5 w-3.5" />
            <span>Password</span>
          </button>
        </div>

        {errorMessage ? (
          <div className="space-y-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-800">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
            {suggestRegister ? (
              <Link
                to={`/register${mobile.trim() ? `?mobile=${encodeURIComponent(mobile.trim())}` : ""}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-900 shadow-xs ring-1 ring-rose-200 transition-colors hover:bg-slate-50"
              >
                <UserPlus className="h-3.5 w-3.5 text-brand-600" />
                <span>Register this mobile as a New Tenant</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        ) : null}

        {authMode === "otp" ? (
          !otpRequested ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <FieldLabel
                  htmlFor="otp-mobile"
                  label="Registered Mobile Number"
                  required
                />
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="otp-mobile"
                    type="tel"
                    placeholder="e.g. 9800000003"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 text-xs text-amber-900">
                <div className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
                  <span>
                    {authConfig?.dev_otp_mode
                      ? "Development OTP Mode"
                      : "SMS Verification Mode"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                  {authConfig?.notice ??
                    "Local OTP verification is active without live SMS delivery."}
                </p>
              </div>

              <Button type="submit" loading={submitting} className="w-full" size="lg">
                <span>Request OTP</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-xs">
                <span className="font-medium text-slate-700">
                  Mobile: <span className="font-mono">{mobile}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOtpRequested(false);
                    setDevOtpPreview(null);
                    setOtpCode("");
                    setErrorMessage(null);
                    cooldown.reset();
                  }}
                  className="font-medium text-brand-600 hover:underline"
                >
                  Change
                </button>
              </div>

              {devOtpPreview ? (
                <DevOtpBanner
                  otp={devOtpPreview}
                  expiresInSeconds={otpExpiresSeconds}
                  onUseCode={(code) => setOtpCode(code)}
                />
              ) : null}

              <div>
                <FieldLabel htmlFor="otp-code" label="Verification OTP" required />
                <Input
                  id="otp-code"
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
                  onClick={(e) => void handleRequestOtp(e)}
                  disabled={submitting || cooldown.secondsLeft > 0}
                  className="flex-1"
                >
                  {cooldown.secondsLeft > 0
                    ? `Resend in ${cooldown.secondsLeft}s`
                    : "Resend OTP"}
                </Button>
                <Button type="submit" loading={submitting} className="flex-1">
                  Verify &amp; Sign In
                </Button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <FieldLabel
                htmlFor="pw-mobile"
                label="Registered Mobile Number"
                required
              />
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="pw-mobile"
                  type="tel"
                  placeholder="e.g. 9800000001"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="pw-input" label="Password" required />
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="pw-input"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <Button type="submit" loading={submitting} className="w-full" size="lg">
              <span>Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        )}

        {/* New Tenant Account CTA */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2.5 text-xs">
          <span className="text-slate-600">New to this PG?</span>
          <Link
            to="/register"
            className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Create Tenant Account</span>
          </Link>
        </div>

        {/* Seeded Dev Quick-Fill Helpers */}
        <div className="border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <UserCheck className="h-3.5 w-3.5 text-slate-400" />
            <span>Quick fill seeded dev credentials (authenticates via API):</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DEV_TEST_CREDENTIALS.map((cred) => (
              <button
                key={cred.mobile}
                type="button"
                onClick={() => applyDemoCredential(cred)}
                className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
              >
                {cred.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </AuthShellLayout>
  );
}
