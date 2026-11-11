import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-slate-200/75", className)}
      aria-hidden="true"
    />
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-card"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-28" />
            </div>
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
          <div className="mt-3 border-t border-slate-100 pt-2">
            <Skeleton className="h-2.5 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-card space-y-3">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-8 w-28" />
      </div>
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="flex items-center justify-between gap-4 py-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-7 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <StatGridSkeleton count={4} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-card lg:col-span-2">
          <Skeleton className="mb-4 h-4 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-card">
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="h-64 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}

