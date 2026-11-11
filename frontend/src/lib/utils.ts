import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(value: string | number | undefined | null): string {
  const num = typeof value === "string" ? parseFloat(value) : Number(value ?? 0);
  if (Number.isNaN(num)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: num % 1 === 0 ? 0 : 2,
  }).format(num);
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function monthName(monthNumber: number): string {
  const date = new Date(2026, Math.max(0, monthNumber - 1), 1);
  return date.toLocaleString("en-IN", { month: "long" });
}

export function validateMobileInput(raw: string): string | null {
  const cleaned = raw.trim();
  const digits = cleaned.replace(/\D/g, "");
  if (cleaned.startsWith("+")) {
    if (digits.length < 10 || digits.length > 15) {
      return "Enter a valid mobile number with country code (10–15 digits).";
    }
    return null;
  }
  if (digits.length === 10 || (digits.length === 12 && digits.startsWith("91"))) {
    return null;
  }
  if (digits.length > 10 && digits.length <= 15) {
    return null;
  }
  return "Please enter a valid 10-digit mobile number (or include country code).";
}

