import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BedDouble, Building2, LogIn, Receipt, ShieldCheck, UserPlus } from "lucide-react";
import brandMark from "@/assets/brand-mark.svg";
import { Badge } from "@/components/ui/Badge";

interface AuthShellLayoutProps {
  activeTab: "login" | "register";
  devOtpMode?: boolean;
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthShellLayout({
  activeTab,
  devOtpMode,
  title,
  subtitle,
  children,
}: AuthShellLayoutProps) {
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-12">
      {/* Left Brand Showcase Column */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy-950 p-10 text-white lg:col-span-5 lg:flex xl:col-span-6 xl:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #94a3b8 1px, transparent 1px), linear-gradient(to bottom, #94a3b8 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={brandMark} alt="Aapka PG" className="h-9 w-9" />
            <div>
              <p className="text-base font-semibold tracking-tight text-white">
                Aapka PG
              </p>
              <p className="text-xs text-slate-400">Hostel &amp; PG Operations</p>
            </div>
          </div>
          <Link
            to="/public-vacancies"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
          >
            <BedDouble className="h-3.5 w-3.5 text-emerald-400" />
            <span>View Public Vacancies</span>
          </Link>
        </div>

        <div className="relative z-10 max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Role-Isolated Workspace for Owners, Managers &amp; Residents</span>
          </div>

          <h2 className="text-3xl font-semibold tracking-tight text-white xl:text-4xl xl:leading-[1.15]">
            Streamlined financial control and daily operations for your PG portfolio.
          </h2>
          <p className="text-sm leading-relaxed text-slate-300">
            Manage room &amp; bed inventory, automated monthly rent ledgers, deposit
            settlements, resident maintenance tickets, and weekly food menus from one
            unified workspace.
          </p>

          <div className="grid grid-cols-1 gap-3 pt-2">
            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="rounded-lg bg-brand-600/20 p-2 text-blue-300">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  Live Occupancy &amp; Vacancy Sharing
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Real-time room/bed tracking with zero-PII public vacancy share links.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-300">
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  Automated Rent Ledgers &amp; PDF Receipts
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Monthly billing generation, partial/offline collection tracking &amp;
                  deposit accounting.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-5 text-xs text-slate-400">
          <span>Verified JWT Session Security</span>
          <span>SQLite / PostgreSQL Ready</span>
        </div>
      </aside>

      {/* Right Authentication Card Column */}
      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8 lg:col-span-7 xl:col-span-6">
        <div className="w-full max-w-md space-y-6">
          {/* Mobile Brand Header */}
          <div className="flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5">
              <img src={brandMark} alt="Aapka PG" className="h-8 w-8" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Aapka PG</p>
                <p className="text-xs text-slate-500">Hostel &amp; PG Operations</p>
              </div>
            </div>
            <Link
              to="/public-vacancies"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Public Vacancies
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-card sm:p-8">
            {/* Top Mode Switcher: Login vs Tenant Registration */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100/90 p-1">
              <Link
                to="/login"
                className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  activeTab === "login"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign In</span>
              </Link>
              <Link
                to="/register"
                className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  activeTab === "register"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Register as Tenant</span>
              </Link>
            </div>

            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                  {title}
                </h1>
                <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
              </div>
              {devOtpMode ? <Badge tone="info">Dev OTP</Badge> : null}
            </div>

            <div className="mt-6">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}

