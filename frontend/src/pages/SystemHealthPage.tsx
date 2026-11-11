import { Activity, AlertCircle, CheckCircle2, Database, RefreshCw, Server } from "lucide-react";
import { InfoCard } from "@/components/InfoCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { useHealthStatus } from "@/hooks/useHealthStatus";

export function SystemHealthPage() {
  const { data, loading, error, lastChecked, refresh } = useHealthStatus();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "System" }, { label: "API & DB Health" }]}
        title="Backend Connectivity & Health Probe"
        subtitle="Live GET /api/health diagnostic check across FastAPI and SQLite / PostgreSQL connection."
        actions={
          <Button size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Run Live Check</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="API Service Status"
          value={error ? "Offline" : loading ? "Checking..." : data?.status?.toUpperCase() ?? "OK"}
          icon={Server}
          tone={error ? "rose" : "emerald"}
        />
        <StatCard
          label="Database Link"
          value={data?.database ?? (error ? "Unavailable" : "Connected")}
          icon={Database}
          tone={error ? "rose" : "blue"}
        />
        <StatCard
          label="Environment"
          value={data?.environment ?? "—"}
          sublabel={lastChecked ? `Checked ${lastChecked.toLocaleTimeString()}` : undefined}
          icon={Activity}
          tone="navy"
        />
      </div>

      <InfoCard
        title="Diagnostic Response"
        subtitle="Direct payload returned by FastAPI health monitor"
        action={
          error ? (
            <StatusBadge variant="error">Offline</StatusBadge>
          ) : (
            <StatusBadge variant="success">{data?.status ?? "ok"}</StatusBadge>
          )
        }
      >
        {loading ? (
          <div className="flex items-center gap-3 rounded-xl border border-brand-200/70 bg-brand-50/50 p-4 text-sm text-brand-700">
            <Activity className="h-5 w-5 animate-pulse" />
            <span>Querying /api/health...</span>
          </div>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <p className="font-semibold">Backend API Unreachable</p>
              <p className="mt-1 text-xs text-rose-700">{error}</p>
              <p className="mt-2 text-xs text-rose-600">
                Ensure the FastAPI server is running on port 8000 before refreshing.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-emerald-950">
                    FastAPI &amp; Database Connected
                  </p>
                  <p className="text-xs text-emerald-700">
                    Checked at {lastChecked ? lastChecked.toLocaleTimeString() : "just now"}
                  </p>
                </div>
              </div>
              <StatusBadge variant="success">{data?.status ?? "ok"}</StatusBadge>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                Live Response Payload
              </p>
              <pre className="overflow-x-auto rounded-xl bg-navy-950 p-4 font-mono text-xs text-blue-100">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </InfoCard>
    </div>
  );
}
