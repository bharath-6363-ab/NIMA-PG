import { downloadProtectedFile } from "@/components/shared/AuthImage";
import { apiClient } from "@/services/apiClient";
import {
  CreatePaymentOrderResponse,
  PaymentItem,
  PaymentMethod,
  ReceiptDetail,
  SecurityDeposit,
  TenantRentSummary,
} from "@/types/api";

export async function fetchTenantRentSummary(): Promise<TenantRentSummary> {
  const res = await apiClient.get<TenantRentSummary>("/api/rent/my");
  return res.data;
}

export async function fetchTenantDeposit(): Promise<SecurityDeposit> {
  const res = await apiClient.get<SecurityDeposit>("/api/deposits/my");
  return res.data;
}

export async function createRentPaymentOrder(payload: {
  rent_record_id: number;
  payment_method: PaymentMethod;
  amount?: string;
}): Promise<CreatePaymentOrderResponse> {
  const res = await apiClient.post<CreatePaymentOrderResponse>(
    "/api/payments/orders",
    payload
  );
  return res.data;
}

export async function verifyRentPayment(payload: {
  payment_id: number;
  gateway_order_id: string;
  gateway_payment_id: string;
  gateway_signature: string;
}): Promise<PaymentItem> {
  const res = await apiClient.post<PaymentItem>("/api/payments/verify", payload);
  return res.data;
}

export async function markRentPaymentFailed(payload: {
  payment_id: number;
  gateway_order_id: string;
  reason?: string;
}): Promise<PaymentItem> {
  const res = await apiClient.post<PaymentItem>("/api/payments/fail", payload);
  return res.data;
}

export async function fetchReceiptDetail(paymentId: number): Promise<ReceiptDetail> {
  const res = await apiClient.get<ReceiptDetail>(`/api/receipts/${paymentId}`);
  return res.data;
}

export async function downloadReceiptPdf(
  paymentId: number,
  receiptNumber: string
): Promise<void> {
  await downloadProtectedFile(
    `/api/receipts/${paymentId}/download`,
    `${receiptNumber}.pdf`
  );
}
