export type UserRole = "owner" | "manager" | "tenant";

export type BedStatus = "vacant" | "occupied" | "notice_period" | "maintenance";
export type SharingType = "single" | "double" | "triple" | "quad" | "shared";
export type TenantStatus = "active" | "notice_period" | "checked_out";
export type PoliceVerificationStatus = "pending" | "submitted" | "verified" | "not_required";
export type DocumentType = "id_proof" | "photo" | "rental_agreement" | "police_verification" | "other";
export type RentStatus = "pending" | "partial" | "paid" | "overdue";
export type PaymentMethod = "upi" | "card" | "net_banking" | "cash" | "bank_transfer";
export type PaymentStatus = "created" | "pending" | "verified_paid" | "failed" | "refunded";
export type DepositStatus = "pending" | "held" | "partially_refunded" | "refunded";
export type ComplaintCategory =
  | "ac"
  | "wifi"
  | "water"
  | "cleaning"
  | "electrical_maintenance"
  | "door_lock"
  | "plumbing"
  | "other";
export type ComplaintStatus =
  | "submitted"
  | "viewed_by_manager"
  | "in_progress"
  | "resolved";
export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";
export type MealType = "breakfast" | "lunch" | "dinner";

export interface AuthUser {
  id: number;
  pg_id: number | null;
  full_name: string;
  mobile: string;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  pg_name: string | null;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: AuthUser;
}

export interface AuthConfigResponse {
  dev_otp_mode: boolean;
  sms_provider_configured: boolean;
  otp_expire_minutes?: number;
  otp_resend_cooldown_seconds?: number;
  notice: string;
}

export interface RequestOTPResponse {
  message: string;
  mobile: string;
  purpose?: "login" | "registration";
  expires_in_seconds: number;
  cooldown_seconds?: number;
  dev_otp_mode: boolean;
  dev_otp: string | null;
}

export interface PublicPGOption {
  id: number;
  name: string;
  city: string;
  gender_policy: string;
}

export interface TenantSelfRegisterPayload {
  full_name: string;
  mobile: string;
  email?: string;
  password: string;
  otp: string;
  pg_id?: number;
}

export interface TenantSelfRegisterResponse {
  message: string;
  user: AuthUser;
}

export interface RegisterUserPayload {
  full_name: string;
  mobile: string;
  email?: string;
  password: string;
  role: UserRole;
}

export interface UserUpdatePayload {
  full_name?: string;
  email?: string;
  is_active?: boolean;
  role?: UserRole;
}

export interface PortalStatusResponse {
  portal: UserRole;
  user_id: number;
  full_name: string;
  mobile: string;
  pg_id: number | null;
  pg_name: string | null;
  status: string;
}

export interface RentRecord {
  id: number;
  tenant_id: number;
  pg_id: number;
  tenant_name: string;
  tenant_mobile: string;
  room_number: string;
  bed_code: string;
  billing_month: number;
  billing_year: number;
  base_rent: string;
  food_charges: string;
  other_charges: string;
  other_charges_note: string | null;
  total_amount: string;
  amount_paid: string;
  balance_due: string;
  due_date: string;
  status: RentStatus;
  reminder_sent_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface GenerateRentResponse {
  billing_month: number;
  billing_year: number;
  created_count: number;
  skipped_existing_count: number;
  ineligible_count: number;
  records: RentRecord[];
}

export interface PaymentItem {
  id: number;
  rent_record_id: number;
  tenant_id: number;
  tenant_name: string;
  room_number: string;
  bed_code: string;
  billing_month: number | null;
  billing_year: number | null;
  amount: string;
  payment_method: PaymentMethod;
  gateway_provider: string;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  status: PaymentStatus;
  receipt_number: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
}

export type DepositTransactionType = "deposit_received" | "deduction" | "refund";

export interface SecurityDepositTransaction {
  id: number;
  transaction_type: DepositTransactionType | string;
  amount: string;
  payment_method: string | null;
  reference_id: string | null;
  reason: string | null;
  transaction_date: string;
  created_at: string;
}

export interface SecurityDeposit {
  id: number | null;
  tenant_id: number | null;
  tenant_name: string;
  tenant_mobile: string;
  room_number: string;
  bed_code: string;
  tenant_status: string;
  amount_held: string;
  paid_status: DepositStatus;
  deduction_amount: string;
  deduction_reason: string | null;
  refund_amount: string;
  refundable_balance: string;
  refund_date: string | null;
  transactions: SecurityDepositTransaction[];
}

export interface TenantRentSummary {
  tenant_id: number;
  tenant_name: string;
  pg_name: string;
  room_number: string;
  bed_code: string;
  current_rent: RentRecord | null;
  previous_bills: RentRecord[];
  security_deposit: SecurityDeposit;
  payment_history: PaymentItem[];
  razorpay_enabled: boolean;
  razorpay_key_id: string | null;
}

export interface CreatePaymentOrderResponse {
  payment_id: number;
  gateway_provider: string;
  gateway_order_id: string;
  amount_paise: number;
  amount_rupees: string;
  currency: string;
  razorpay_key_id: string | null;
}

export interface ReceiptDetail {
  receipt_number: string;
  pg_name: string;
  pg_address: string;
  tenant_name: string;
  tenant_mobile: string;
  room_number: string;
  bed_code: string;
  billing_period: string;
  base_rent: string;
  food_charges: string;
  other_charges: string;
  amount_paid: string;
  remaining_balance: string;
  payment_status: string;
  payment_method: string;
  gateway_payment_id: string | null;
  paid_at: string;
  whatsapp_share_text: string;
  whatsapp_share_url: string;
}

export interface ComplaintImage {
  id: number;
  file_name: string;
  mime_type: string;
  url: string;
}

export interface ComplaintHistoryItem {
  id: number;
  old_status: string | null;
  new_status: string;
  remarks: string | null;
  changed_by_name?: string | null;
  changed_at: string;
}

export interface ComplaintItem {
  id: number;
  tenant_id: number;
  pg_id?: number;
  bed_id?: number | null;
  tenant_name: string;
  room_number: string;
  bed_code: string;
  category: ComplaintCategory;
  title: string;
  description: string;
  status: ComplaintStatus;
  manager_remarks: string | null;
  assigned_manager_name?: string | null;
  submitted_at: string;
  viewed_at: string | null;
  in_progress_at: string | null;
  resolved_at: string | null;
  tenant_rating: number | null;
  tenant_feedback: string | null;
  images: ComplaintImage[];
  history: ComplaintHistoryItem[];
}

export interface TenantComplaintSummary {
  total_count: number;
  open_count: number;
  in_progress_count: number;
  resolved_count: number;
  complaints: ComplaintItem[];
}

export interface FoodMenuItem {
  id: number;
  item_name: string;
  is_veg: boolean;
  sort_order: number;
}

export interface FoodMenuSlot {
  id: number;
  day_of_week: DayOfWeek;
  meal_type: MealType;
  meal_name?: string;
  description?: string | null;
  items_description: string;
  menu_items?: FoodMenuItem[];
  timing_label: string;
  image_url?: string | null;
  is_available?: boolean;
  is_published?: boolean;
  updated_at?: string | null;
}

export interface MealSkipItem {
  id: number;
  skip_date: string;
  meal_type: MealType;
  status: "active" | "cancelled" | string;
  reason: string | null;
  can_cancel: boolean;
  cancelled_at?: string | null;
  created_at: string;
}

export interface MealRatingItem {
  id: number;
  meal_date: string;
  meal_type: MealType;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface TenantFoodOverview {
  weekly_menu: FoodMenuSlot[];
  my_skips: MealSkipItem[];
  my_ratings: MealRatingItem[];
  meal_timings: Record<string, string>;
  cutoff_times?: Record<string, string>;
}

export interface NotificationItem {
  id: number;
  notif_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface ManagerComplaintSummary {
  total_count?: number;
  new_count: number;
  viewed_count?: number;
  in_progress_count: number;
  resolved_count: number;
  complaints: ComplaintItem[];
}

export interface ManagerFoodOverview {
  target_date: string;
  is_menu_published?: boolean;
  cutoff_times?: Record<string, string>;
  weekly_menu: FoodMenuSlot[];
  skip_counts: Record<string, number>;
  skip_details: {
    id: number;
    tenant_name: string;
    room_number: string;
    bed_code?: string;
    skip_date?: string;
    meal_type: MealType;
    status?: string;
    reason: string | null;
    created_at?: string;
  }[];
  average_ratings: Record<string, number | null>;
  rating_counts?: Record<string, number>;
  recent_ratings: {
    id: number;
    tenant_name: string;
    room_number?: string;
    meal_date: string;
    meal_type: MealType;
    rating: number;
    comment: string | null;
  }[];
}

export interface TenantAllocationHistoryItem {
  id: number;
  room_id: number;
  room_number: string;
  bed_id: number;
  bed_code: string;
  action: string;
  start_date: string;
  end_date: string | null;
  monthly_rent: string;
  food_charges: string;
  remarks: string | null;
  created_at: string;
}

export interface TenantDocumentItem {
  id: number;
  doc_type: DocumentType;
  file_name: string;
  mime_type: string;
  uploaded_at: string;
  url: string;
}

export interface TenantSummary {
  id: number;
  user_id: number;
  full_name: string;
  mobile: string;
  email: string | null;
  gender: string | null;
  date_of_birth: string | null;
  permanent_address: string | null;
  room_id: number;
  room_number: string;
  bed_id: number;
  bed_code: string;
  monthly_rent: string;
  food_charges: string;
  security_deposit_amount: string;
  joining_date: string;
  expected_leaving_date: string | null;
  notice_date: string | null;
  leaving_date: string | null;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  police_verification_status: PoliceVerificationStatus;
  status: TenantStatus;
  notes: string | null;
  checkout_remarks: string | null;
  deposit_status: DepositStatus | null;
  deposit_deduction_amount: string | null;
  deposit_deduction_reason: string | null;
  deposit_refund_amount: string | null;
  documents: TenantDocumentItem[];
  allocation_history: TenantAllocationHistoryItem[];
}

export interface BedDetail {
  id: number;
  room_id: number;
  room_number: string;
  floor: string;
  sharing_type: SharingType;
  bed_label: string;
  bed_code: string;
  status: BedStatus;
  monthly_rent: string;
  food_charges: string;
  vacant_since: string | null;
  is_publicly_available?: boolean;
  occupant_tenant_id: number | null;
  occupant_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomDetail {
  id: number;
  pg_id: number;
  room_number: string;
  floor: string;
  sharing_type: SharingType;
  max_capacity: number;
  description: string | null;
  base_rent: string;
  is_active: boolean;
  total_beds: number;
  vacant_beds: number;
  occupied_beds: number;
  notice_period_beds: number;
  maintenance_beds: number;
  created_at: string;
  updated_at: string;
  beds: BedDetail[];
}

export interface TenantCreateResponse {
  tenant: TenantSummary;
  account_created: boolean;
  temporary_password: string | null;
}

export interface TenantCheckoutResponse {
  tenant: TenantSummary;
  deposit_held: string;
  deduction_amount: string;
  refund_amount: string;
  deposit_status: DepositStatus;
  bed_code: string;
  bed_status: BedStatus;
}

export interface RoomWithBeds {
  id: number;
  room_number: string;
  floor: string;
  sharing_type: "single" | "double" | "triple" | "quad";
  base_rent: string;
  beds: {
    id: number;
    bed_label: string;
    bed_code: string;
    status: BedStatus;
    monthly_rent: string;
    tenant_id: number | null;
    tenant_name: string | null;
  }[];
}

export interface OwnerPendingRentRow {
  rent_record_id: number;
  tenant_id: number;
  tenant_name: string;
  tenant_mobile: string;
  room_number: string;
  bed_code: string;
  total_amount: string;
  amount_paid: string;
  balance_due: string;
  due_date: string;
  days_overdue: number;
  status: RentStatus;
  reminder_sent_at: string | null;
}

export interface OwnerTransactionRow {
  payment_id: number;
  receipt_number: string | null;
  tenant_id: number;
  tenant_name: string;
  room_number: string;
  bed_code: string;
  amount: string;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  paid_at: string | null;
}

export interface PropertySummary {
  id: number;
  name: string;
  city: string;
  total_rooms: number;
  total_beds: number;
  occupied_beds: number;
  vacant_beds: number;
  occupancy_percentage: number;
}

export interface OwnerRecentTenantRow {
  id: number;
  full_name: string;
  room_number: string;
  bed_code: string;
  joining_date: string;
  monthly_rent: string;
  status: TenantStatus;
}

export interface OwnerRecentComplaintRow {
  id: number;
  title: string;
  category: ComplaintCategory;
  status: ComplaintStatus;
  tenant_name: string;
  room_number: string;
  updated_at: string;
}

export interface OwnerRecentCheckoutRow {
  id: number;
  full_name: string;
  room_number: string;
  bed_code: string;
  leaving_date: string | null;
  checkout_remarks?: string | null;
}

export interface OwnerActivityItem {
  activity_type: "payment" | "registration" | "complaint" | "checkout";
  title: string;
  subtitle: string;
  timestamp: string;
  amount?: string | null;
}

export interface OwnerFinanceDashboard {
  pg_id?: number;
  pg_name?: string;
  month: number;
  year: number;
  start_date?: string | null;
  end_date?: string | null;
  total_properties?: number;
  properties?: PropertySummary[];
  total_rooms?: number;
  occupied_beds: number;
  vacant_beds?: number;
  notice_period_beds?: number;
  maintenance_beds?: number;
  total_beds: number;
  occupancy_percentage?: number;
  total_active_tenants?: number;
  total_expected_rent: string;
  total_collected_rent: string;
  total_pending_rent: string;
  total_overdue_rent: string;
  paid_tenants_count: number;
  pending_tenants_count: number;
  overdue_tenants_count: number;
  total_security_deposits_held: string;
  pending_tenants: OwnerPendingRentRow[];
  recent_transactions: OwnerTransactionRow[];
  recently_registered_tenants?: OwnerRecentTenantRow[];
  recent_complaints?: OwnerRecentComplaintRow[];
  recent_checkouts?: OwnerRecentCheckoutRow[];
  recent_activity?: OwnerActivityItem[];
  monthly_trend: {
    label: string;
    month: number;
    year: number;
    expected: string;
    collected: string;
  }[];
}

export interface FinancialReportRow {
  rent_record_id: number;
  tenant_id: number;
  tenant_name: string;
  tenant_mobile: string;
  room_number: string;
  bed_code: string;
  billing_month: number;
  billing_year: number;
  base_rent: string;
  food_charges: string;
  other_charges: string;
  total_amount: string;
  amount_paid: string;
  balance_due: string;
  due_date: string;
  days_overdue: number;
  status: RentStatus;
}

export interface FinancialDepositReportRow {
  tenant_id: number;
  tenant_name: string;
  tenant_mobile: string;
  room_number: string;
  bed_code: string;
  tenant_status: TenantStatus;
  amount_held: string;
  deduction_amount: string;
  refund_amount: string;
  refundable_balance: string;
  paid_status: DepositStatus;
}

export interface OwnerFinancialReports {
  pg_id: number;
  pg_name: string;
  month: number;
  year: number;
  collection_rate_percentage: number;
  total_expected_rent: string;
  total_collected_rent: string;
  total_pending_rent: string;
  total_overdue_rent: string;
  total_security_deposits_held: string;
  total_deposit_deductions: string;
  total_deposit_refunds: string;
  monthly_collection_rows: FinancialReportRow[];
  pending_rent_rows: FinancialReportRow[];
  overdue_rent_rows: FinancialReportRow[];
  payment_history_rows: PaymentItem[];
  security_deposit_rows: FinancialDepositReportRow[];
}

export interface BedVacancy {
  id: number;
  room_id: number;
  room_number: string;
  floor: string;
  sharing_type: SharingType;
  bed_label: string;
  bed_code: string;
  status: BedStatus;
  monthly_rent: string;
  days_vacant: number;
  is_publicly_available?: boolean;
  occupant_name: string | null;
  notice_date?: string | null;
  expected_leaving_date?: string | null;
}

export interface VacancyShareLink {
  id: number;
  token: string;
  title: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  share_path: string;
}

export interface OwnerVacancyDashboard {
  pg_id?: number;
  pg_name?: string;
  properties?: PropertySummary[];
  total_rooms: number;
  total_beds: number;
  occupied_beds: number;
  vacant_beds: number;
  notice_period_beds: number;
  maintenance_beds: number;
  occupancy_percentage?: number;
  vacant_monthly_potential: string;
  beds: BedVacancy[];
  share_links: VacancyShareLink[];
}

export interface PublicVacancyPage {
  pg_name: string;
  address: string;
  city: string;
  gender_policy: "coed" | "male" | "female";
  amenities: string;
  breakfast_timing: string;
  lunch_timing: string;
  dinner_timing: string;
  title: string;
  vacant_beds_count: number;
  notice_period_beds_count: number;
  available_beds: {
    room_number: string;
    floor: string;
    sharing_type: SharingType;
    bed_code: string;
    status: BedStatus;
    monthly_rent: string;
    days_vacant: number;
  }[];
}

export interface PublicVacancyDirectoryItem extends PublicVacancyPage {
  share_token: string;
  share_path: string;
}

export interface ManagerItem {
  id: number;
  full_name: string;
  mobile: string;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PGSettings {
  id: number;
  name: string;
  address: string;
  city: string;
  gender_policy: "coed" | "male" | "female";
  rent_due_day: number;
  default_monthly_rent: string;
  default_food_charges: string;
  default_security_deposit: string;
  breakfast_timing: string;
  lunch_timing: string;
  dinner_timing: string;
  amenities: string;
}
