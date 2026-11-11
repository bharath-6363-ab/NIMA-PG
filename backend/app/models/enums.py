import enum


class UserRole(str, enum.Enum):
    OWNER = "owner"
    MANAGER = "manager"
    TENANT = "tenant"


class GenderPolicy(str, enum.Enum):
    COED = "coed"
    MALE = "male"
    FEMALE = "female"


class SharingType(str, enum.Enum):
    SINGLE = "single"
    DOUBLE = "double"
    TRIPLE = "triple"
    QUAD = "quad"
    SHARED = "shared"


class BedStatus(str, enum.Enum):
    VACANT = "vacant"
    OCCUPIED = "occupied"
    NOTICE_PERIOD = "notice_period"
    MAINTENANCE = "maintenance"


class TenantStatus(str, enum.Enum):
    ACTIVE = "active"
    NOTICE_PERIOD = "notice_period"
    CHECKED_OUT = "checked_out"


class PoliceVerificationStatus(str, enum.Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    VERIFIED = "verified"
    NOT_REQUIRED = "not_required"


class DocumentType(str, enum.Enum):
    ID_PROOF = "id_proof"
    PHOTO = "photo"
    RENTAL_AGREEMENT = "rental_agreement"
    POLICE_VERIFICATION = "police_verification"
    OTHER = "other"


class RentStatus(str, enum.Enum):
    PENDING = "pending"
    PARTIAL = "partial"
    PAID = "paid"
    OVERDUE = "overdue"


class PaymentMethod(str, enum.Enum):
    UPI = "upi"
    CARD = "card"
    NET_BANKING = "net_banking"
    CASH = "cash"
    BANK_TRANSFER = "bank_transfer"


class PaymentStatus(str, enum.Enum):
    CREATED = "created"
    PENDING = "pending"
    VERIFIED_PAID = "verified_paid"
    FAILED = "failed"
    REFUNDED = "refunded"


class DepositStatus(str, enum.Enum):
    PENDING = "pending"
    HELD = "held"
    PARTIALLY_REFUNDED = "partially_refunded"
    REFUNDED = "refunded"


class ComplaintCategory(str, enum.Enum):
    AC = "ac"
    WIFI = "wifi"
    WATER = "water"
    CLEANING = "cleaning"
    ELECTRICAL_MAINTENANCE = "electrical_maintenance"
    DOOR_LOCK = "door_lock"
    PLUMBING = "plumbing"
    OTHER = "other"


class ComplaintStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    VIEWED_BY_MANAGER = "viewed_by_manager"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"


class DayOfWeek(str, enum.Enum):
    MONDAY = "monday"
    TUESDAY = "tuesday"
    WEDNESDAY = "wednesday"
    THURSDAY = "thursday"
    FRIDAY = "friday"
    SATURDAY = "saturday"
    SUNDAY = "sunday"


class MealType(str, enum.Enum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"


class NotificationType(str, enum.Enum):
    RENT_REMINDER = "rent_reminder"
    PAYMENT_RECEIPT = "payment_receipt"
    COMPLAINT_UPDATE = "complaint_update"
    GENERAL = "general"


class VacancyStatus(str, enum.Enum):
    OPEN = "open"
    FILLED = "filled"

