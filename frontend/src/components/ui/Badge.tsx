import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "success" | "warning" | "error" | "info" | "neutral";

const TONES: Record<BadgeTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  error: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  info: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20",
  neutral: "bg-slate-100/90 text-slate-700 ring-1 ring-inset ring-slate-600/10",
};

const DOT_TONES: Record<BadgeTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
  info: "bg-brand-500",
  neutral: "bg-slate-400",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", DOT_TONES[tone])} /> : null}
      {children}
    </span>
  );
}
