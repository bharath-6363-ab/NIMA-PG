import { downloadProtectedFile } from "@/components/shared/AuthImage";
import { apiClient } from "@/services/apiClient";
import {
  BedStatus,
  BedVacancy,
  OwnerFinanceDashboard,
  OwnerFinancialReports,
  OwnerVacancyDashboard,
  PGSettings,
  PaymentMethod,
  PublicVacancyDirectoryItem,
  PublicVacancyPage,
  RentStatus,
  VacancyShareLink,
} from "@/types/api";

export async function fetchOwnerDashboard(params?: {
  month?: number;
  year?: number;
  pg_id?: number;
  start_date?: string;
  end_date?: string;
  search?: string;
}): Promise<OwnerFinanceDashboard> {
  const res = await apiClient.get<OwnerFinanceDashboard>("/api/owner/finance/dashboard", {
    params,
  });
  return res.data;
}

export async function sendOwnerRentReminder(rentRecordId: number): Promise<{
  rent_record_id: number;
  reminder_sent_at: string;
  message: string;
  whatsapp_url: string;
}> {
  const res = await apiClient.post(`/api/owner/finance/reminders/${rentRecordId}`);
  return res.data;
}

export async function fetchOwnerFinancialReports(params: {
  month: number;
  year: number;
  pg_id?: number;
  search?: string;
  status?: RentStatus | "";
  payment_method?: PaymentMethod | "";
}): Promise<OwnerFinancialReports> {
  const clean: Record<string, string | number> = {
    month: params.month,
    year: params.year,
  };
  if (params.pg_id) clean.pg_id = params.pg_id;
  if (params.search?.trim()) clean.search = params.search.trim();
  if (params.status) clean.status = params.status;
  if (params.payment_method) clean.payment_method = params.payment_method;
  const res = await apiClient.get<OwnerFinancialReports>(
    "/api/owner/finance/reports-data",
    { params: clean }
  );
  return res.data;
}

export async function downloadOwnerFinancialReport(params: {
  month: number;
  year: number;
  fmt: "csv" | "pdf";
  report_type: "collection" | "pending" | "overdue" | "payments" | "deposits";
  pg_id?: number;
  search?: string;
}): Promise<void> {
  const qs = new URLSearchParams({
    month: String(params.month),
    year: String(params.year),
    fmt: params.fmt,
    report_type: params.report_type,
  });
  if (params.pg_id) qs.set("pg_id", String(params.pg_id));
  if (params.search?.trim()) qs.set("search", params.search.trim());
  await downloadProtectedFile(
    `/api/owner/finance/report?${qs.toString()}`,
    `financial-${params.report_type}-${params.year}-${String(params.month).padStart(2, "0")}.${params.fmt}`
  );
}

export async function fetchVacancyOverview(params?: {
  pg_id?: number;
  room_id?: number;
  status?: BedStatus | "";
  search?: string;
  public_only?: boolean;
}): Promise<OwnerVacancyDashboard> {
  const clean: Record<string, string | number | boolean> = {};
  if (params?.pg_id) clean.pg_id = params.pg_id;
  if (params?.room_id) clean.room_id = params.room_id;
  if (params?.status) clean.status = params.status;
  if (params?.search?.trim()) clean.search = params.search.trim();
  if (params?.public_only) clean.public_only = true;
  const res = await apiClient.get<OwnerVacancyDashboard>("/api/vacancy", {
    params: clean,
  });
  return res.data;
}

export async function updateVacancyBed(
  bedId: number,
  payload: { status?: BedStatus; is_publicly_available?: boolean },
  pgId?: number
): Promise<BedVacancy> {
  const res = await apiClient.patch<BedVacancy>(`/api/vacancy/beds/${bedId}`, payload, {
    params: pgId ? { pg_id: pgId } : undefined,
  });
  return res.data;
}

export async function createVacancyShareLink(
  payload: { title: string; expires_in_days?: number | null },
  pgId?: number
): Promise<VacancyShareLink> {
  const res = await apiClient.post<VacancyShareLink>(
    "/api/owner/vacancy/share-links",
    payload,
    { params: pgId ? { pg_id: pgId } : undefined }
  );
  return res.data;
}

export async function revokeVacancyShareLink(linkId: number): Promise<void> {
  await apiClient.delete(`/api/owner/vacancy/share-links/${linkId}`);
}

export async function fetchPublicVacancyByToken(token: string): Promise<PublicVacancyPage> {
  const res = await apiClient.get<PublicVacancyPage>(`/api/public/vacancy/${token}`);
  return res.data;
}

export async function fetchPublicVacanciesDirectory(): Promise<PublicVacancyDirectoryItem[]> {
  const res = await apiClient.get<PublicVacancyDirectoryItem[]>("/api/public/vacancies");
  return res.data;
}

export type PGSettingsUpdatePayload = {
  name?: string;
  address?: string;
  city?: string;
  gender_policy?: "coed" | "male" | "female";
  rent_due_day?: number;
  default_monthly_rent?: number;
  default_food_charges?: number;
  default_security_deposit?: number;
  breakfast_timing?: string;
  lunch_timing?: string;
  dinner_timing?: string;
  amenities?: string;
};

export async function fetchOwnerPgSettings(pgId?: number): Promise<PGSettings> {
  const res = await apiClient.get<PGSettings>("/api/owner/pg", {
    params: pgId ? { pg_id: pgId } : undefined,
  });
  return res.data;
}

export async function updateOwnerPgSettings(
  payload: PGSettingsUpdatePayload,
  pgId?: number
): Promise<PGSettings> {
  const res = await apiClient.put<PGSettings>("/api/owner/pg", payload, {
    params: pgId ? { pg_id: pgId } : undefined,
  });
  return res.data;
}

