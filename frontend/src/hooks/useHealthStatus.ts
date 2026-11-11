import { useCallback, useEffect, useState } from "react";
import { extractApiError } from "@/services/apiClient";
import { fetchHealthStatus, HealthStatusResponse } from "@/services/healthService";

export function useHealthStatus() {
  const [data, setData] = useState<HealthStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchHealthStatus();
      setData(payload);
      setLastChecked(new Date());
    } catch (err) {
      setData(null);
      setError(extractApiError(err));
      setLastChecked(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, lastChecked, refresh };
}

