import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "neutral" | "navy" | "emerald" | "blue" | "amber" | "rose";

const ICON_WELL: Record<StatTone, string> = {
  neutral: "bg-slate-100 text-slate-600 ring-slate-200/70",
  navy: "bg-navy-900 text-white ring-navy-800",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  blue: "bg-brand-50 text-brand-700 ring-brand-200/70",
  amber: "bg-amber-50 text-amber-700 ring-amber-200/70",
  rose: "bg-rose-50 text-rose-700 ring-rose-200/70",
};

const VALUE_COLOR: Record<StatTone, string> = {
  neutral: "text-slate-900",
  navy: "text-navy-900",
  emerald: "text-emerald-700",
  blue: "text-brand-700",
  amber: "text-amber-700",
  rose: "text-rose-700",
};

export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "neutral",
  badge,
  className,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group rounded-xl border border-slate-200/85 bg-white p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300/90 hover:shadow-card-hover",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-500">{label}</p>
          <p
            className={cn(
              "mt-1.5 text-2xl font-semibold tracking-tight tabular-nums",
              VALUE_COLOR[tone]
            )}
          >
            {value}
          </p>
        </div>
        {Icon ? (
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-transform duration-200 group-hover:scale-105",
              ICON_WELL[tone]
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {sublabel || badge ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
          {sublabel ? (
            <span className="text-[11px] text-slate-500">{sublabel}</span>
          ) : (
            <span />
          )}
          {badge}
        </div>
      ) : null}
    </div>
  );
}

