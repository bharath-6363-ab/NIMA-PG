import axios, { AxiosError } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const TOKEN_STORAGE_KEY = "aapka_pg_access_token";

export function getStoredToken(): string | null {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const reqUrl = error.config?.url ?? "";
    const isAuthAttempt =
      reqUrl.includes("/auth/login") ||
      reqUrl.includes("/auth/verify-otp") ||
      reqUrl.includes("/auth/otp/verify") ||
      reqUrl.includes("/auth/request-otp") ||
      reqUrl.includes("/auth/otp/request") ||
      reqUrl.includes("/auth/tenant-register/");

    if (error.response?.status === 401 && !isAuthAttempt) {
      clearStoredToken();
      window.dispatchEvent(new CustomEvent("aapka_pg:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export function extractApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<{ detail?: unknown; message?: string }>;
    const detail = axiosErr.response?.data?.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string; loc?: unknown[] };
      if (first?.msg) {
        return first.msg;
      }
    }
    if (axiosErr.message) {
      return axiosErr.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected network error occurred.";
}
