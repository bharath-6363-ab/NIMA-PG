import { apiClient } from "@/services/apiClient";
import {
  DocumentType,
  PoliceVerificationStatus,
  TenantAllocationHistoryItem,
  TenantCheckoutResponse,
  TenantCreateResponse,
  TenantDocumentItem,
  TenantStatus,
  TenantSummary,
} from "@/types/api";

export async function getMyTenantProfile(): Promise<TenantSummary> {
  const res = await apiClient.get<TenantSummary>("/api/tenants/me");
  return res.data;
}

export async function listTenants(params?: {
  status?: TenantStatus;
  room_number?: string;
  search?: string;
}): Promise<TenantSummary[]> {
  const res = await apiClient.get<TenantSummary[]>("/api/tenants", { params });
  return res.data;
}

export async function getTenantDetail(tenantId: number): Promise<TenantSummary> {
  const res = await apiClient.get<TenantSummary>(`/api/tenants/${tenantId}`);
  return res.data;
}

export async function registerTenant(payload: {
  full_name: string;
  mobile: string;
  email?: string;
  gender?: string;
  date_of_birth?: string;
  permanent_address?: string;
  bed_id: number;
  monthly_rent: string;
  food_charges: string;
  security_deposit_amount: string;
  joining_date: string;
  expected_leaving_date?: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  police_verification_status: PoliceVerificationStatus;
  password?: string;
  notes?: string;
}): Promise<TenantCreateResponse> {
  const res = await apiClient.post<TenantCreateResponse>("/api/tenants", payload);
  return res.data;
}

export async function updateTenant(
  tenantId: number,
  payload: {
    full_name?: string;
    email?: string;
    gender?: string;
    date_of_birth?: string;
    permanent_address?: string;
    monthly_rent?: string;
    food_charges?: string;
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
    police_verification_status?: PoliceVerificationStatus;
    expected_leaving_date?: string;
    notice_date?: string;
    status?: TenantStatus;
    notes?: string;
  }
): Promise<TenantSummary> {
  const res = await apiClient.patch<TenantSummary>(`/api/tenants/${tenantId}`, payload);
  return res.data;
}

export async function uploadTenantDocument(
  tenantId: number,
  docType: DocumentType,
  file: File
): Promise<TenantDocumentItem> {
  const form = new FormData();
  form.append("doc_type", docType);
  form.append("file", file);
  const res = await apiClient.post<TenantDocumentItem>(
    `/api/tenants/${tenantId}/documents`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return res.data;
}

export async function checkoutTenant(
  tenantId: number,
  payload: {
    leaving_date: string;
    deduction_amount: string;
    deduction_reason?: string;
    checkout_remarks?: string;
    mark_bed_maintenance: boolean;
  }
): Promise<TenantCheckoutResponse> {
  const res = await apiClient.post<TenantCheckoutResponse>(
    `/api/tenants/${tenantId}/checkout`,
    payload
  );
  return res.data;
}

export async function getTenantHistory(
  tenantId: number
): Promise<TenantAllocationHistoryItem[]> {
  const res = await apiClient.get<TenantAllocationHistoryItem[]>(
    `/api/tenants/${tenantId}/history`
  );
  return res.data;
}

