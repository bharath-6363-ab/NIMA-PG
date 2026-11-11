import { ReactNode } from "react";

interface InfoCardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InfoCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: InfoCardProps) {
  return (
    <section
      className={`rounded-xl border border-slate-200/85 bg-white shadow-card ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div>{action}</div> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
