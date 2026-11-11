import { apiClient } from "@/services/apiClient";

export interface HealthStatusResponse {
  status: string;
  database: string;
  environment: string;
  service: string;
}

export async function fetchHealthStatus(): Promise<HealthStatusResponse> {
  const response = await apiClient.get<HealthStatusResponse>("/api/health");
  return response.data;
}

