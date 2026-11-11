from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, EmailStr, Field

from app.models.enums import (
    BedStatus,
    ComplaintCategory,
    ComplaintStatus,
    DayOfWeek,
    DepositStatus,
    DocumentType,
    GenderPolicy,
    MealType,
    PaymentMethod,
    PaymentStatus,
    PoliceVerificationStatus,
    RentStatus,
    SharingType,
    TenantStatus,
)


# ---------------------------------------------------------------------------
# Tenant Online Rent & Payments
# ---------------------------------------------------------------------------
class RentRecordOut(BaseModel):
    id: int
    tenant_id: int
    pg_id: int
    tenant_name: str = ""
    tenant_mobile: str = ""
    room_number: str = "-"
    bed_code: str = "-"
    billing_month: int
    billing_year: int
    base_rent: Decimal
    food_charges: Decimal
    other_charges: Decimal = Decimal("0.00")
    other_charges_note: str | None = None
    total_amount: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    due_date: date
    status: RentStatus
    reminder_sent_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PaymentOut(BaseModel):
    id: int
    rent_record_id: int
    tenant_id: int = 0
    tenant_name: str = ""
    room_number: str = "-"
    bed_code: str = "-"
    billing_month: int | None = None
    billing_year: int | None = None
    amount: Decimal
    payment_method: PaymentMethod
    gateway_provider: str
    gateway_order_id: str | None
    gateway_payment_id: str | None
    status: PaymentStatus
    receipt_number: str | None
    paid_at: datetime | None
    notes: str | None = None
    created_at: datetime


class SecurityDepositTransactionOut(BaseModel):
    id: int
    transaction_type: str
    amount: Decimal
    payment_method: str | None = None
    reference_id: str | None = None
    reason: str | None = None
    transaction_date: date
    created_at: datetime


class SecurityDepositOut(BaseModel):
    id: int | None = None
    tenant_id: int | None = None
    tenant_name: str = ""
    tenant_mobile: str = ""
    room_number: str = "-"
    bed_code: str = "-"
    tenant_status: str = ""
    amount_held: Decimal
    paid_status: DepositStatus
    deduction_amount: Decimal
    deduction_reason: str | None
    refund_amount: Decimal
    refundable_balance: Decimal = Decimal("0.00")
    refund_date: date | None
    transactions: list[SecurityDepositTransactionOut] = []


class DepositTransactionCreateIn(BaseModel):
    transaction_type: Literal["deposit_received", "deduction", "refund"]
    amount: Decimal = Field(..., gt=0)
    payment_method: str | None = Field(default="bank_transfer", max_length=40)
    reference_id: str | None = Field(default=None, max_length=120)
    reason: str | None = Field(default=None, max_length=500)
    transaction_date: date | None = None


class GenerateRentIn(BaseModel):
    billing_month: int = Field(..., ge=1, le=12)
    billing_year: int = Field(..., ge=2020, le=2100)


class GenerateRentOut(BaseModel):
    billing_month: int
    billing_year: int
    created_count: int
    skipped_existing_count: int
    ineligible_count: int
    records: list[RentRecordOut]


class RentRecordUpdateIn(BaseModel):
    other_charges: Decimal | None = Field(default=None, ge=0)
    other_charges_note: str | None = Field(default=None, max_length=255)
    due_date: date | None = None


class OfflinePaymentIn(BaseModel):
    rent_record_id: int
    amount: Decimal = Field(..., gt=0)
    payment_method: PaymentMethod = Field(default=PaymentMethod.CASH)
    transaction_ref: str | None = Field(default=None, max_length=120)
    payment_date: date | None = None
    notes: str | None = Field(default=None, max_length=500)


class FailPaymentIn(BaseModel):
    payment_id: int
    gateway_order_id: str
    reason: str | None = Field(default=None, max_length=300)


class TenantRentSummaryOut(BaseModel):
    tenant_id: int
    tenant_name: str
    pg_name: str
    room_number: str
    bed_code: str
    current_rent: RentRecordOut | None
    previous_bills: list[RentRecordOut] = []
    security_deposit: SecurityDepositOut
    payment_history: list[PaymentOut]
    razorpay_enabled: bool
    razorpay_key_id: str | None = None


class CreatePaymentOrderIn(BaseModel):
    rent_record_id: int
    payment_method: PaymentMethod = Field(
        default=PaymentMethod.UPI,
        description="Supported online methods: upi, card, net_banking.",
    )
    amount: Decimal | None = Field(default=None, gt=0)


class CreatePaymentOrderOut(BaseModel):
    payment_id: int
    gateway_provider: str
    gateway_order_id: str
    amount_paise: int
    amount_rupees: Decimal
    currency: str = "INR"
    razorpay_key_id: str | None = None


class VerifyPaymentIn(BaseModel):
    payment_id: int
    gateway_order_id: str
    gateway_payment_id: str
    gateway_signature: str


class ReceiptDetailOut(BaseModel):
    receipt_number: str
    pg_name: str
    pg_address: str
    tenant_name: str
    tenant_mobile: str
    room_number: str
    bed_code: str
    billing_period: str
    base_rent: Decimal
    food_charges: Decimal
    other_charges: Decimal = Decimal("0.00")
    amount_paid: Decimal
    remaining_balance: Decimal = Decimal("0.00")
    payment_status: str = "verified_paid"
    payment_method: str
    gateway_payment_id: str | None
    paid_at: datetime
    whatsapp_share_text: str
    whatsapp_share_url: str


# ---------------------------------------------------------------------------
# Complaints
# ---------------------------------------------------------------------------
class ComplaintImageOut(BaseModel):
    id: int
    file_name: str
    mime_type: str
    url: str


class ComplaintHistoryOut(BaseModel):
    id: int
    old_status: str | None
    new_status: str
    remarks: str | None
    changed_by_name: str | None = None
    changed_at: datetime


class ComplaintOut(BaseModel):
    id: int
    tenant_id: int
    pg_id: int
    bed_id: int | None = None
    tenant_name: str
    room_number: str
    bed_code: str
    category: ComplaintCategory
    title: str
    description: str
    status: ComplaintStatus
    manager_remarks: str | None
    assigned_manager_name: str | None = None
    submitted_at: datetime
    viewed_at: datetime | None
    in_progress_at: datetime | None
    resolved_at: datetime | None
    tenant_rating: int | None
    tenant_feedback: str | None
    images: list[ComplaintImageOut] = []
    history: list[ComplaintHistoryOut] = []


class TenantComplaintSummaryOut(BaseModel):
    total_count: int
    open_count: int
    in_progress_count: int
    resolved_count: int
    complaints: list[ComplaintOut]


class ComplaintRateIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    feedback: str | None = Field(default=None, max_length=1000)


class ComplaintStatusUpdateIn(BaseModel):
    status: ComplaintStatus
    remarks: str | None = Field(default=None, max_length=1000)


class ManagerComplaintSummaryOut(BaseModel):
    total_count: int = 0
    new_count: int
    viewed_count: int = 0
    in_progress_count: int
    resolved_count: int
    complaints: list[ComplaintOut]


class NotificationOut(BaseModel):
    id: int
    notif_type: str
    title: str
    message: str
    is_read: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Food Menu, Skip Requests & Ratings
# ---------------------------------------------------------------------------
class FoodMenuItemIn(BaseModel):
    item_name: str = Field(..., min_length=1, max_length=120)
    is_veg: bool = True


class FoodMenuItemOut(BaseModel):
    id: int
    item_name: str
    is_veg: bool
    sort_order: int


class FoodMenuSlotOut(BaseModel):
    id: int
    day_of_week: DayOfWeek
    meal_type: MealType
    meal_name: str = ""
    description: str | None = None
    items_description: str
    menu_items: list[FoodMenuItemOut] = []
    timing_label: str
    image_url: str | None = None
    is_available: bool = True
    is_published: bool = True
    updated_at: datetime | None = None


class MealSkipOut(BaseModel):
    id: int
    skip_date: date
    meal_type: MealType
    status: str = "active"
    reason: str | None
    can_cancel: bool = True
    cancelled_at: datetime | None = None
    created_at: datetime


class MealRatingOut(BaseModel):
    id: int
    meal_date: date
    meal_type: MealType
    rating: int
    comment: str | None
    created_at: datetime
    updated_at: datetime | None = None


class TenantFoodOverviewOut(BaseModel):
    weekly_menu: list[FoodMenuSlotOut]
    my_skips: list[MealSkipOut]
    my_ratings: list[MealRatingOut]
    meal_timings: dict[str, str]
    cutoff_times: dict[str, str] = {}


class MealSkipCreateIn(BaseModel):
    skip_date: date
    meal_type: MealType
    reason: str | None = Field(default=None, max_length=255)


class MealRatingCreateIn(BaseModel):
    meal_date: date
    meal_type: MealType
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class FoodMenuUpdateSlotIn(BaseModel):
    day_of_week: DayOfWeek
    meal_type: MealType
    meal_name: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    items_description: str | None = Field(default=None, max_length=500)
    menu_items: list[FoodMenuItemIn] | None = None
    timing_label: str = Field(..., min_length=2, max_length=60)
    is_available: bool = True
    is_published: bool = True


class FoodMenuSlotPatchIn(BaseModel):
    meal_name: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    items_description: str | None = Field(default=None, max_length=500)
    menu_items: list[FoodMenuItemIn] | None = None
    timing_label: str | None = Field(default=None, min_length=2, max_length=60)
    is_available: bool | None = None
    is_published: bool | None = None


class FoodMenuPublishIn(BaseModel):
    is_published: bool


class FoodMenuBulkUpdateIn(BaseModel):
    slots: list[FoodMenuUpdateSlotIn] = Field(..., min_length=1)


class ManagerFoodOverviewOut(BaseModel):
    target_date: date
    is_menu_published: bool = True
    cutoff_times: dict[str, str] = {}
    weekly_menu: list[FoodMenuSlotOut]
    skip_counts: dict[str, int]
    skip_details: list[dict]
    average_ratings: dict[str, float | None]
    rating_counts: dict[str, int] = {}
    recent_ratings: list[dict]


# ---------------------------------------------------------------------------
# Manager Tenant Registration, Checkout & Rooms
# ---------------------------------------------------------------------------
class TenantDocumentOut(BaseModel):
    id: int
    doc_type: DocumentType
    file_name: str
    mime_type: str
    uploaded_at: datetime
    url: str


class TenantAllocationHistoryOut(BaseModel):
    id: int
    room_id: int
    room_number: str
    bed_id: int
    bed_code: str
    action: str
    start_date: date
    end_date: date | None
    monthly_rent: Decimal
    food_charges: Decimal
    remarks: str | None
    created_at: datetime


class TenantSummaryOut(BaseModel):
    id: int
    user_id: int
    full_name: str
    mobile: str
    email: str | None
    gender: str | None
    date_of_birth: date | None = None
    permanent_address: str | None = None
    room_id: int
    room_number: str
    bed_id: int
    bed_code: str
    monthly_rent: Decimal
    food_charges: Decimal
    security_deposit_amount: Decimal
    joining_date: date
    expected_leaving_date: date | None = None
    notice_date: date | None
    leaving_date: date | None
    emergency_contact_name: str
    emergency_contact_phone: str
    police_verification_status: PoliceVerificationStatus
    status: TenantStatus
    notes: str | None
    checkout_remarks: str | None = None
    deposit_status: DepositStatus | None = None
    deposit_deduction_amount: Decimal | None = None
    deposit_deduction_reason: str | None = None
    deposit_refund_amount: Decimal | None = None
    documents: list[TenantDocumentOut] = []
    allocation_history: list[TenantAllocationHistoryOut] = []


class TenantCreateIn(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    mobile: str = Field(..., min_length=10, max_length=20)
    email: EmailStr | None = None
    gender: str | None = Field(default=None, max_length=20)
    date_of_birth: date | None = None
    permanent_address: str | None = Field(default=None, max_length=500)
    bed_id: int
    monthly_rent: Decimal = Field(..., ge=0)
    food_charges: Decimal = Field(default=Decimal("0.00"), ge=0)
    security_deposit_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    joining_date: date
    expected_leaving_date: date | None = None
    emergency_contact_name: str = Field(..., min_length=2, max_length=120)
    emergency_contact_phone: str = Field(..., min_length=10, max_length=20)
    police_verification_status: PoliceVerificationStatus = PoliceVerificationStatus.PENDING
    password: str | None = Field(default=None, min_length=6, max_length=128)
    notes: str | None = Field(default=None, max_length=1000)


class TenantCreateOut(BaseModel):
    tenant: TenantSummaryOut
    account_created: bool
    temporary_password: str | None = None


class TenantUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    gender: str | None = Field(default=None, max_length=20)
    date_of_birth: date | None = None
    permanent_address: str | None = Field(default=None, max_length=500)
    monthly_rent: Decimal | None = Field(default=None, ge=0)
    food_charges: Decimal | None = Field(default=None, ge=0)
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, max_length=20)
    police_verification_status: PoliceVerificationStatus | None = None
    expected_leaving_date: date | None = None
    notice_date: date | None = None
    status: TenantStatus | None = None
    notes: str | None = Field(default=None, max_length=1000)


class TenantCheckoutIn(BaseModel):
    leaving_date: date
    deduction_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    deduction_reason: str | None = Field(default=None, max_length=500)
    checkout_remarks: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=1000)
    mark_bed_maintenance: bool = False


class TenantCheckoutOut(BaseModel):
    tenant: TenantSummaryOut
    deposit_held: Decimal
    deduction_amount: Decimal
    refund_amount: Decimal
    deposit_status: DepositStatus
    bed_code: str
    bed_status: BedStatus


class BedStatusUpdateIn(BaseModel):
    status: BedStatus


class BedCreateIn(BaseModel):
    room_id: int
    bed_label: str = Field(..., min_length=1, max_length=20)
    monthly_rent: Decimal = Field(..., gt=0)
    food_charges: Decimal = Field(default=Decimal("0.00"), ge=0)
    status: BedStatus = BedStatus.VACANT


class BedUpdateIn(BaseModel):
    bed_label: str | None = Field(default=None, min_length=1, max_length=20)
    monthly_rent: Decimal | None = Field(default=None, gt=0)
    food_charges: Decimal | None = Field(default=None, ge=0)
    status: BedStatus | None = None
    is_publicly_available: bool | None = None


class BedDetailOut(BaseModel):
    id: int
    room_id: int
    room_number: str
    floor: str
    sharing_type: SharingType
    bed_label: str
    bed_code: str
    status: BedStatus
    monthly_rent: Decimal
    food_charges: Decimal
    vacant_since: datetime | None
    is_publicly_available: bool = True
    occupant_tenant_id: int | None = None
    occupant_name: str | None = None
    created_at: datetime
    updated_at: datetime


class RoomDetailOut(BaseModel):
    id: int
    pg_id: int
    room_number: str
    floor: str
    sharing_type: SharingType
    max_capacity: int
    description: str | None
    base_rent: Decimal
    is_active: bool
    total_beds: int
    vacant_beds: int
    occupied_beds: int
    notice_period_beds: int
    maintenance_beds: int
    created_at: datetime
    updated_at: datetime
    beds: list[BedDetailOut] = []


# ---------------------------------------------------------------------------
# Owner Finance, Vacancy, Managers & Settings
# ---------------------------------------------------------------------------
class PropertySummaryOut(BaseModel):
    id: int
    name: str
    city: str
    total_rooms: int
    total_beds: int
    occupied_beds: int
    vacant_beds: int
    occupancy_percentage: float


class OwnerRecentTenantRow(BaseModel):
    id: int
    full_name: str
    room_number: str
    bed_code: str
    joining_date: date
    monthly_rent: Decimal
    status: TenantStatus


class OwnerRecentComplaintRow(BaseModel):
    id: int
    title: str
    category: ComplaintCategory
    status: ComplaintStatus
    tenant_name: str
    room_number: str
    updated_at: datetime


class OwnerRecentCheckoutRow(BaseModel):
    id: int
    full_name: str
    room_number: str
    bed_code: str
    leaving_date: date | None
    checkout_remarks: str | None = None


class OwnerActivityItem(BaseModel):
    activity_type: Literal["payment", "registration", "complaint", "checkout"]
    title: str
    subtitle: str
    timestamp: datetime
    amount: Decimal | None = None


class OwnerPendingRentRow(BaseModel):
    rent_record_id: int
    tenant_id: int
    tenant_name: str
    tenant_mobile: str
    room_number: str
    bed_code: str
    total_amount: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    due_date: date
    days_overdue: int
    status: RentStatus
    reminder_sent_at: datetime | None


class OwnerTransactionRow(BaseModel):
    payment_id: int
    receipt_number: str | None
    tenant_id: int
    tenant_name: str
    room_number: str
    bed_code: str
    amount: Decimal
    payment_method: PaymentMethod
    status: PaymentStatus
    paid_at: datetime | None


class MonthlyTrendPoint(BaseModel):
    label: str
    month: int
    year: int
    expected: Decimal
    collected: Decimal


class OwnerFinanceDashboardOut(BaseModel):
    pg_id: int = 0
    pg_name: str = ""
    month: int
    year: int
    start_date: date | None = None
    end_date: date | None = None
    total_properties: int = 1
    properties: list[PropertySummaryOut] = []
    total_rooms: int = 0
    occupied_beds: int
    vacant_beds: int = 0
    notice_period_beds: int = 0
    maintenance_beds: int = 0
    total_beds: int
    occupancy_percentage: float = 0.0
    total_active_tenants: int = 0
    total_expected_rent: Decimal
    total_collected_rent: Decimal
    total_pending_rent: Decimal
    total_overdue_rent: Decimal
    paid_tenants_count: int
    pending_tenants_count: int
    overdue_tenants_count: int
    total_security_deposits_held: Decimal
    pending_tenants: list[OwnerPendingRentRow]
    recent_transactions: list[OwnerTransactionRow]
    recently_registered_tenants: list[OwnerRecentTenantRow] = []
    recent_complaints: list[OwnerRecentComplaintRow] = []
    recent_checkouts: list[OwnerRecentCheckoutRow] = []
    recent_activity: list[OwnerActivityItem] = []
    monthly_trend: list[MonthlyTrendPoint]


class FinancialReportRowOut(BaseModel):
    rent_record_id: int
    tenant_id: int
    tenant_name: str
    tenant_mobile: str
    room_number: str
    bed_code: str
    billing_month: int
    billing_year: int
    base_rent: Decimal
    food_charges: Decimal
    other_charges: Decimal
    total_amount: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    due_date: date
    days_overdue: int
    status: RentStatus


class FinancialDepositReportRowOut(BaseModel):
    tenant_id: int
    tenant_name: str
    tenant_mobile: str
    room_number: str
    bed_code: str
    tenant_status: TenantStatus
    amount_held: Decimal
    deduction_amount: Decimal
    refund_amount: Decimal
    refundable_balance: Decimal
    paid_status: DepositStatus


class OwnerFinancialReportsOut(BaseModel):
    pg_id: int
    pg_name: str
    month: int
    year: int
    collection_rate_percentage: float
    total_expected_rent: Decimal
    total_collected_rent: Decimal
    total_pending_rent: Decimal
    total_overdue_rent: Decimal
    total_security_deposits_held: Decimal
    total_deposit_deductions: Decimal
    total_deposit_refunds: Decimal
    monthly_collection_rows: list[FinancialReportRowOut]
    pending_rent_rows: list[FinancialReportRowOut]
    overdue_rent_rows: list[FinancialReportRowOut]
    payment_history_rows: list[PaymentOut]
    security_deposit_rows: list[FinancialDepositReportRowOut]


class ManualPaymentIn(BaseModel):
    rent_record_id: int
    amount: Decimal = Field(..., gt=0)
    payment_method: PaymentMethod = PaymentMethod.CASH
    notes: str | None = Field(default=None, max_length=500)


class BedVacancyOut(BaseModel):
    id: int
    room_id: int
    room_number: str
    floor: str
    sharing_type: SharingType
    bed_label: str
    bed_code: str
    status: BedStatus
    monthly_rent: Decimal
    days_vacant: int
    is_publicly_available: bool = True
    occupant_name: str | None = None
    notice_date: date | None = None
    expected_leaving_date: date | None = None


class BedVacancyUpdateIn(BaseModel):
    status: BedStatus | None = None
    is_publicly_available: bool | None = None


class VacancyShareLinkOut(BaseModel):
    id: int
    token: str
    title: str
    is_active: bool
    expires_at: datetime | None
    created_at: datetime
    share_path: str


class VacancyShareLinkCreateIn(BaseModel):
    title: str = Field(default="Live Bed Availability", min_length=2, max_length=120)
    expires_in_days: int | None = Field(default=30, ge=1, le=365)


class OwnerVacancyDashboardOut(BaseModel):
    pg_id: int = 0
    pg_name: str = ""
    properties: list[PropertySummaryOut] = []
    total_rooms: int
    total_beds: int
    occupied_beds: int
    vacant_beds: int
    notice_period_beds: int
    maintenance_beds: int
    occupancy_percentage: float = 0.0
    vacant_monthly_potential: Decimal
    beds: list[BedVacancyOut]
    share_links: list[VacancyShareLinkOut]


class PublicVacancyBedOut(BaseModel):
    room_number: str
    floor: str
    sharing_type: SharingType
    bed_code: str
    status: BedStatus
    monthly_rent: Decimal
    days_vacant: int


class PublicVacancyPageOut(BaseModel):
    pg_name: str
    address: str
    city: str
    gender_policy: GenderPolicy
    amenities: str
    breakfast_timing: str
    lunch_timing: str
    dinner_timing: str
    title: str
    vacant_beds_count: int
    notice_period_beds_count: int
    available_beds: list[PublicVacancyBedOut]


class ManagerCreateIn(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    mobile: str = Field(..., min_length=10, max_length=20)
    email: EmailStr | None = None
    password: str = Field(..., min_length=6, max_length=128)


class ManagerUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=6, max_length=128)


class ManagerOut(BaseModel):
    id: int
    full_name: str
    mobile: str
    email: str | None
    is_active: bool
    created_at: datetime


class PGSettingsUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    address: str | None = None
    city: str | None = Field(default=None, max_length=80)
    gender_policy: GenderPolicy | None = None
    rent_due_day: int | None = Field(default=None, ge=1, le=28)
    default_monthly_rent: Decimal | None = Field(default=None, ge=0)
    default_food_charges: Decimal | None = Field(default=None, ge=0)
    default_security_deposit: Decimal | None = Field(default=None, ge=0)
    breakfast_timing: str | None = Field(default=None, max_length=60)
    lunch_timing: str | None = Field(default=None, max_length=60)
    dinner_timing: str | None = Field(default=None, max_length=60)
    amenities: str | None = None


class RoomCreateIn(BaseModel):
    room_number: str = Field(..., min_length=1, max_length=30)
    floor: str = Field(default="1st Floor", max_length=30)
    sharing_type: SharingType = SharingType.DOUBLE
    max_capacity: int = Field(default=2, ge=1, le=20)
    description: str | None = Field(default=None, max_length=500)
    base_rent: Decimal = Field(..., gt=0)
    food_charges: Decimal = Field(default=Decimal("0.00"), ge=0)
    auto_create_beds: bool = True
    bed_labels: list[str] | None = None


class RoomUpdateIn(BaseModel):
    room_number: str | None = Field(default=None, min_length=1, max_length=30)
    floor: str | None = Field(default=None, max_length=30)
    sharing_type: SharingType | None = None
    max_capacity: int | None = Field(default=None, ge=1, le=20)
    description: str | None = Field(default=None, max_length=500)
    base_rent: Decimal | None = Field(default=None, gt=0)
    is_active: bool | None = None

