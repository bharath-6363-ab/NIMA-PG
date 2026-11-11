import { downloadProtectedFile } from "@/components/shared/AuthImage";
import { apiClient } from "@/services/apiClient";
import {
  DepositTransactionType,
  GenerateRentResponse,
  PaymentItem,
  PaymentMethod,
  ReceiptDetail,
  RentRecord,
  SecurityDeposit,
} from "@/types/api";

export async function generateMonthlyRent(payload: {
  billing_month: number;
  billing_year: number;
}): Promise<GenerateRentResponse> {
  const res = await apiClient.post<GenerateRentResponse>("/api/rent/generate", payload);
  return res.data;
}

export async function fetchRentRecords(params?: {
  month?: number;
  year?: number;
  status?: string;
  search?: string;
}): Promise<RentRecord[]> {
  const res = await apiClient.get<RentRecord[]>("/api/rent/records", { params });
  return res.data;
}

export async function fetchOutstandingRentRecords(): Promise<RentRecord[]> {
  const res = await apiClient.get<RentRecord[]>("/api/rent/records/outstanding");
  return res.data;
}

export async function fetchRentRecordDetail(rentRecordId: number): Promise<RentRecord> {
  const res = await apiClient.get<RentRecord>(`/api/rent/records/${rentRecordId}`);
  return res.data;
}

export async function updateRentRecordCharges(
  rentRecordId: number,
  payload: {
    other_charges?: string | number;
    other_charges_note?: string | null;
    due_date?: string;
  }
): Promise<RentRecord> {
  const res = await apiClient.patch<RentRecord>(
    `/api/rent/records/${rentRecordId}`,
    payload
  );
  return res.data;
}

export async function fetchTenantRentHistory(tenantId: number): Promise<RentRecord[]> {
  const res = await apiClient.get<RentRecord[]>(`/api/rent/tenants/${tenantId}/history`);
  return res.data;
}

export async function recordOfflinePayment(payload: {
  rent_record_id: number;
  amount: string | number;
  payment_method: PaymentMethod;
  transaction_ref?: string;
  payment_date?: string;
  notes?: string;
}): Promise<PaymentItem> {
  const res = await apiClient.post<PaymentItem>("/api/payments/offline", payload);
  return res.data;
}

export async function fetchPayments(tenantId?: number): Promise<PaymentItem[]> {
  const res = await apiClient.get<PaymentItem[]>("/api/payments", {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return res.data;
}

export async function fetchPaymentDetail(paymentId: number): Promise<PaymentItem> {
  const res = await apiClient.get<PaymentItem>(`/api/payments/${paymentId}`);
  return res.data;
}

export async function fetchFinanceReceiptDetail(paymentId: number): Promise<ReceiptDetail> {
  const res = await apiClient.get<ReceiptDetail>(`/api/receipts/${paymentId}`);
  return res.data;
}

export async function downloadFinanceReceiptPdf(
  paymentId: number,
  receiptNumber: string
): Promise<void> {
  await downloadProtectedFile(
    `/api/receipts/${paymentId}/download`,
    `${receiptNumber}.pdf`
  );
}

export async function fetchAllDeposits(): Promise<SecurityDeposit[]> {
  const res = await apiClient.get<SecurityDeposit[]>("/api/deposits");
  return res.data;
}

export async function fetchTenantDepositDetail(tenantId: number): Promise<SecurityDeposit> {
  const res = await apiClient.get<SecurityDeposit>(`/api/deposits/${tenantId}`);
  return res.data;
}

export async function recordDepositTransaction(
  tenantId: number,
  payload: {
    transaction_type: DepositTransactionType;
    amount: string | number;
    payment_method?: string;
    reference_id?: string;
    reason?: string;
    transaction_date?: string;
  }
): Promise<SecurityDeposit> {
  const res = await apiClient.post<SecurityDeposit>(
    `/api/deposits/${tenantId}/transactions`,
    payload
  );
  return res.data;
}

