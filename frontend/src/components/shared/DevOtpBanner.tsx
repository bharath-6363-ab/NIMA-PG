import { Check, Copy, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

interface DevOtpBannerProps {
  otp: string;
  expiresInSeconds?: number;
  onUseCode?: (otp: string) => void;
}

export function DevOtpBanner({
  otp,
  expiresInSeconds = 300,
  onUseCode,
}: DevOtpBannerProps) {
  const [copied, setCopied] = useState(false);
  const expireMinutes = Math.max(1, Math.round(expiresInSeconds / 60));

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(otp);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  }

  return (
    <div
      data-testid="dev-otp-banner"
      className="rounded-xl border border-brand-200 bg-brand-50/85 p-3.5 text-xs text-brand-900"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-brand-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-brand-600" />
          <span>Development OTP (No SMS Sent)</span>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">
          Valid {expireMinutes} min
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200/90 bg-white px-3 py-2">
        <span
          data-testid="dev-otp-code"
          className="font-mono text-lg font-bold tracking-[0.28em] text-navy-900"
        >
          {otp}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
            title="Copy OTP code"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-600" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy</span>
              </>
            )}
          </button>

          {onUseCode ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onUseCode(otp)}
              className="h-7 px-2.5 text-[11px]"
            >
              Use Code
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

