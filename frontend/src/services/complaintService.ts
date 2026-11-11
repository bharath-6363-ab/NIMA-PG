import { apiClient } from "@/services/apiClient";
import {
  ComplaintCategory,
  ComplaintItem,
  ComplaintStatus,
  ManagerComplaintSummary,
  NotificationItem,
  TenantComplaintSummary,
} from "@/types/api";

export async function fetchTenantComplaintSummary(): Promise<TenantComplaintSummary> {
  const res = await apiClient.get<TenantComplaintSummary>("/api/complaints/my");
  return res.data;
}

export async function submitTenantComplaint(payload: {
  category: ComplaintCategory;
  title: string;
  description: string;
  image?: File | null;
}): Promise<ComplaintItem> {
  const form = new FormData();
  form.append("category", payload.category);
  form.append("title", payload.title);
  form.append("description", payload.description);
  if (payload.image) {
    form.append("image", payload.image);
  }
  const res = await apiClient.post<ComplaintItem>("/api/complaints", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function fetchComplaintDetail(complaintId: number): Promise<ComplaintItem> {
  const res = await apiClient.get<ComplaintItem>(`/api/complaints/${complaintId}`);
  return res.data;
}

export async function rateResolvedComplaint(
  complaintId: number,
  payload: { rating: number; feedback?: string }
): Promise<ComplaintItem> {
  const res = await apiClient.post<ComplaintItem>(
    `/api/complaints/${complaintId}/rate`,
    payload
  );
  return res.data;
}

export async function fetchManagerComplaints(params?: {
  status_group?: string;
  status?: ComplaintStatus | "";
  category?: ComplaintCategory | "";
  search?: string;
  sort_order?: "desc" | "asc";
}): Promise<ManagerComplaintSummary> {
  const cleanParams: Record<string, string> = {};
  if (params?.status_group) cleanParams.status_group = params.status_group;
  if (params?.status) cleanParams.status = params.status;
  if (params?.category) cleanParams.category = params.category;
  if (params?.search?.trim()) cleanParams.search = params.search.trim();
  if (params?.sort_order) cleanParams.sort_order = params.sort_order;
  const res = await apiClient.get<ManagerComplaintSummary>("/api/complaints", {
    params: cleanParams,
  });
  return res.data;
}

export async function updateManagerComplaintStatus(
  complaintId: number,
  payload: { status: ComplaintStatus; remarks?: string }
): Promise<ComplaintItem> {
  const res = await apiClient.patch<ComplaintItem>(
    `/api/complaints/${complaintId}/status`,
    payload
  );
  return res.data;
}

export async function fetchMyNotifications(): Promise<NotificationItem[]> {
  const res = await apiClient.get<NotificationItem[]>("/api/notifications");
  return res.data;
}

export async function markNotificationRead(notifId: number): Promise<void> {
  await apiClient.post(`/api/notifications/${notifId}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post("/api/notifications/read-all");
}

