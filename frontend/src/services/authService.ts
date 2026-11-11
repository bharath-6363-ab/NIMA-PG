import { apiClient } from "@/services/apiClient";
import {
  AuthConfigResponse,
  AuthUser,
  PortalStatusResponse,
  PublicPGOption,
  RegisterUserPayload,
  RequestOTPResponse,
  TenantSelfRegisterPayload,
  TenantSelfRegisterResponse,
  TokenResponse,
  UserRole,
  UserUpdatePayload,
} from "@/types/api";

export async function getAuthConfig(): Promise<AuthConfigResponse> {
  const res = await apiClient.get<AuthConfigResponse>("/api/auth/config");
  return res.data;
}

export async function loginWithPassword(payload: {
  mobile: string;
  password: string;
  portal_role?: UserRole;
}): Promise<TokenResponse> {
  const res = await apiClient.post<TokenResponse>("/api/auth/login", payload);
  return res.data;
}

export async function requestOtp(payload: {
  mobile: string;
  portal_role?: UserRole;
}): Promise<RequestOTPResponse> {
  const res = await apiClient.post<RequestOTPResponse>("/api/auth/request-otp", payload);
  return res.data;
}

export async function verifyOtp(payload: {
  mobile: string;
  otp: string;
  portal_role?: UserRole;
}): Promise<TokenResponse> {
  const res = await apiClient.post<TokenResponse>("/api/auth/verify-otp", payload);
  return res.data;
}

export async function logoutSession(): Promise<void> {
  await apiClient.post("/api/auth/logout");
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await apiClient.get<AuthUser>("/api/auth/me");
  return res.data;
}

export async function fetchPortalStatus(
  portal: UserRole
): Promise<PortalStatusResponse> {
  const res = await apiClient.get<PortalStatusResponse>(`/api/auth/portal/${portal}`);
  return res.data;
}

export async function listPgUsers(): Promise<AuthUser[]> {
  const res = await apiClient.get<AuthUser[]>("/api/auth/users");
  return res.data;
}

export async function registerUserAccount(
  payload: RegisterUserPayload
): Promise<AuthUser> {
  const res = await apiClient.post<AuthUser>("/api/auth/register", payload);
  return res.data;
}

export async function updateUserAccount(
  userId: number,
  payload: UserUpdatePayload
): Promise<AuthUser> {
  const res = await apiClient.patch<AuthUser>(`/api/auth/users/${userId}`, payload);
  return res.data;
}

export async function fetchRegistrationOptions(): Promise<PublicPGOption[]> {
  const res = await apiClient.get<PublicPGOption[]>("/api/auth/registration-options");
  return res.data;
}

export async function requestTenantRegistrationOtp(payload: {
  mobile: string;
}): Promise<RequestOTPResponse> {
  const res = await apiClient.post<RequestOTPResponse>(
    "/api/auth/tenant-register/request-otp",
    payload
  );
  return res.data;
}

export async function completeTenantRegistration(
  payload: TenantSelfRegisterPayload
): Promise<TenantSelfRegisterResponse> {
  const res = await apiClient.post<TenantSelfRegisterResponse>(
    "/api/auth/tenant-register/verify",
    payload
  );
  return res.data;
}

