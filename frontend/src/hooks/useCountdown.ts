import { useCallback, useEffect, useState } from "react";

/** Shared countdown hook (seconds) for OTP resend cooldown timers. */
export function useCountdown(initialSeconds = 0) {
  const [secondsLeft, setSecondsLeft] = useState<number>(initialSeconds);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const start = useCallback((seconds: number) => {
    setSecondsLeft(Math.max(0, Math.ceil(seconds)));
  }, []);

  const reset = useCallback(() => {
    setSecondsLeft(0);
  }, []);

  return { secondsLeft, start, reset };
}

