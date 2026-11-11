from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.complaint import Complaint, ComplaintHistory
from app.models.enums import (
    BedStatus,
    ComplaintCategory,
    ComplaintStatus,
    DayOfWeek,
    DepositStatus,
    GenderPolicy,
    MealType,
    PaymentMethod,
    PaymentStatus,
    PoliceVerificationStatus,
    RentStatus,
    SharingType,
    TenantStatus,
    UserRole,
    VacancyStatus,
)
from app.models.finance import Payment, RentRecord, SecurityDeposit, SecurityDepositTransaction
from app.models.food import FoodMenu, FoodMenuItem
from app.models.property import Bed, PGProperty, Room, VacancyRecord
from app.models.tenant import Tenant, TenantAllocationHistory
from app.models.user import User


def _prev_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def seed_database(db: Session) -> dict[str, str]:
    """Seed realistic PG data idempotently for local development (zero electricity meter data)."""
    existing_owner = db.scalar(select(User).where(User.mobile == "+919800000001"))
    if existing_owner is not None:
        return {"status": "skipped", "reason": "Seed data already exists."}

    now = datetime.now(timezone.utc)
    today = date.today()
    prev_year, prev_month = _prev_month(today.year, today.month)

    owner = User(
        full_name="Rajesh Agarwal (Malik)",
        mobile="+919800000001",
        email="owner@aapkapg.com",
        password_hash=hash_password("Owner@123"),
        role=UserRole.OWNER,
        is_active=True,
    )
    db.add(owner)
    db.flush()

    pg = PGProperty(
        owner_id=owner.id,
        name="Aapka PG Residences",
        address="Plot 42, Sector 18, HSR Layout",
        city="Bengaluru",
        gender_policy=GenderPolicy.COED,
        rent_due_day=5,
        default_monthly_rent=Decimal("7500.00"),
        default_food_charges=Decimal("1000.00"),
        default_security_deposit=Decimal("15000.00"),
        breakfast_timing="7:30 AM - 9:30 AM",
        lunch_timing="12:30 PM - 2:30 PM",
        dinner_timing="8:00 PM - 10:00 PM",
        amenities="High-Speed WiFi, 3-Time Home Food, RO Drinking Water, Daily Housekeeping, CCTV",
    )
    db.add(pg)
    db.flush()

    owner.pg_id = pg.id

    manager = User(
        pg_id=pg.id,
        full_name="Suresh Verma",
        mobile="+919800000002",
        email="manager@aapkapg.com",
        password_hash=hash_password("Manager@123"),
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(manager)
    db.flush()

    room_specs = [
        ("101", "1st Floor", SharingType.DOUBLE, Decimal("7500.00"), ["A", "B"]),
        ("102", "1st Floor", SharingType.DOUBLE, Decimal("7500.00"), ["A", "B"]),
        ("103", "1st Floor", SharingType.DOUBLE, Decimal("8000.00"), ["A", "B"]),
        ("201", "2nd Floor", SharingType.DOUBLE, Decimal("8000.00"), ["A", "B"]),
        ("202", "2nd Floor", SharingType.SINGLE, Decimal("11000.00"), ["A"]),
    ]
    beds_by_code: dict[str, Bed] = {}
    rooms_by_num: dict[str, Room] = {}

    for r_num, floor, sharing, base_rent, labels in room_specs:
        room = Room(
            pg_id=pg.id,
            room_number=r_num,
            floor=floor,
            sharing_type=sharing,
            base_rent=base_rent,
            is_active=True,
        )
        db.add(room)
        db.flush()
        rooms_by_num[r_num] = room

        for lbl in labels:
            code = f"{r_num}-{lbl}"
            bed = Bed(
                pg_id=pg.id,
                room_id=room.id,
                bed_label=lbl,
                bed_code=code,
                status=BedStatus.VACANT,
                monthly_rent=base_rent,
                vacant_since=now - timedelta(days=12),
            )
            db.add(bed)
            db.flush()
            beds_by_code[code] = bed

    # Seed 3 active tenants
    tenant_specs = [
        {
            "name": "Rahul Sharma",
            "mobile": "+919800000003",
            "email": "rahul@example.com",
            "gender": "male",
            "bed_code": "101-A",
            "rent": Decimal("7500.00"),
            "food": Decimal("1000.00"),
            "deposit": Decimal("15000.00"),
            "status": TenantStatus.ACTIVE,
            "bed_status": BedStatus.OCCUPIED,
            "paid_current": True,
        },
        {
            "name": "Neha Patel",
            "mobile": "+919800000004",
            "email": "neha@example.com",
            "gender": "female",
            "bed_code": "101-B",
            "rent": Decimal("7500.00"),
            "food": Decimal("1000.00"),
            "deposit": Decimal("15000.00"),
            "status": TenantStatus.ACTIVE,
            "bed_status": BedStatus.OCCUPIED,
            "paid_current": False,
        },
        {
            "name": "Amit Kumar",
            "mobile": "+919800000005",
            "email": "amit@example.com",
            "gender": "male",
            "bed_code": "102-A",
            "rent": Decimal("7500.00"),
            "food": Decimal("1000.00"),
            "deposit": Decimal("15000.00"),
            "status": TenantStatus.NOTICE_PERIOD,
            "bed_status": BedStatus.NOTICE_PERIOD,
            "paid_current": False,
        },
    ]

    created_tenants: list[Tenant] = []
    for idx, spec in enumerate(tenant_specs, start=1):
        t_user = User(
            pg_id=pg.id,
            full_name=spec["name"],
            mobile=spec["mobile"],
            email=spec["email"],
            password_hash=hash_password("Tenant@123"),
            role=UserRole.TENANT,
            is_active=True,
        )
        db.add(t_user)
        db.flush()

        bed = beds_by_code[spec["bed_code"]]
        bed.status = spec["bed_status"]
        bed.vacant_since = None

        tenant = Tenant(
            user_id=t_user.id,
            pg_id=pg.id,
            room_id=bed.room_id,
            bed_id=bed.id,
            full_name=spec["name"],
            mobile=spec["mobile"],
            email=spec["email"],
            gender=spec["gender"],
            emergency_contact_name="Family Guardian",
            emergency_contact_phone="+919811111111",
            monthly_rent=spec["rent"],
            food_charges=spec["food"],
            security_deposit_amount=spec["deposit"],
            joining_date=today - timedelta(days=90),
            notice_date=today - timedelta(days=5) if spec["status"] == TenantStatus.NOTICE_PERIOD else None,
            police_verification_status=PoliceVerificationStatus.VERIFIED,
            status=spec["status"],
            created_by=manager.id,
        )
        db.add(tenant)
        db.flush()
        created_tenants.append(tenant)

        db.add(
            TenantAllocationHistory(
                pg_id=pg.id,
                tenant_id=tenant.id,
                room_id=bed.room_id,
                bed_id=bed.id,
                action="allocated",
                start_date=tenant.joining_date,
                monthly_rent=spec["rent"],
                food_charges=spec["food"],
                remarks="Initial seeded room & bed allocation",
                actor_user_id=manager.id,
            )
        )

        dep = SecurityDeposit(
            tenant_id=tenant.id,
            pg_id=pg.id,
            amount_held=spec["deposit"],
            paid_status=DepositStatus.HELD,
        )
        db.add(dep)
        db.flush()
        db.add(
            SecurityDepositTransaction(
                security_deposit_id=dep.id,
                tenant_id=tenant.id,
                pg_id=pg.id,
                transaction_type="deposit_received",
                amount=spec["deposit"],
                payment_method="upi",
                reason="Initial security deposit collected at joining",
                transaction_date=tenant.joining_date,
                recorded_by=manager.id,
            )
        )

        total_due = spec["rent"] + spec["food"]
        # Previous month paid record
        prev_due_date = date(prev_year, prev_month, pg.rent_due_day)
        prev_record = RentRecord(
            tenant_id=tenant.id,
            pg_id=pg.id,
            billing_month=prev_month,
            billing_year=prev_year,
            room_number_snapshot=spec["bed_code"].split("-")[0],
            bed_code_snapshot=spec["bed_code"],
            base_rent=spec["rent"],
            food_charges=spec["food"],
            total_amount=total_due,
            amount_paid=total_due,
            due_date=prev_due_date,
            status=RentStatus.PAID,
        )
        db.add(prev_record)
        db.flush()

        db.add(
            Payment(
                rent_record_id=prev_record.id,
                tenant_id=tenant.id,
                pg_id=pg.id,
                amount=total_due,
                payment_method=PaymentMethod.UPI,
                gateway_provider="razorpay_test",
                gateway_order_id=f"order_seed_prev_{idx}",
                gateway_payment_id=f"pay_seed_prev_{idx}",
                status=PaymentStatus.VERIFIED_PAID,
                receipt_number=f"RCPT-{prev_year}{prev_month:02d}-{idx:04d}",
                paid_at=now - timedelta(days=32),
            )
        )

        # Current month rent record
        curr_due_date = date(today.year, today.month, pg.rent_due_day)
        if spec["paid_current"]:
            curr_status = RentStatus.PAID
            curr_paid = total_due
        elif today > curr_due_date:
            curr_status = RentStatus.OVERDUE
            curr_paid = Decimal("0.00")
        else:
            curr_status = RentStatus.PENDING
            curr_paid = Decimal("0.00")

        curr_record = RentRecord(
            tenant_id=tenant.id,
            pg_id=pg.id,
            billing_month=today.month,
            billing_year=today.year,
            room_number_snapshot=spec["bed_code"].split("-")[0],
            bed_code_snapshot=spec["bed_code"],
            base_rent=spec["rent"],
            food_charges=spec["food"],
            total_amount=total_due,
            amount_paid=curr_paid,
            due_date=curr_due_date,
            status=curr_status,
        )
        db.add(curr_record)
        db.flush()

        if spec["paid_current"]:
            db.add(
                Payment(
                    rent_record_id=curr_record.id,
                    tenant_id=tenant.id,
                    pg_id=pg.id,
                    amount=total_due,
                    payment_method=PaymentMethod.UPI,
                    gateway_provider="razorpay_test",
                    gateway_order_id=f"order_seed_curr_{idx}",
                    gateway_payment_id=f"pay_seed_curr_{idx}",
                    status=PaymentStatus.VERIFIED_PAID,
                    receipt_number=f"RCPT-{today.year}{today.month:02d}-{idx:04d}",
                    paid_at=now - timedelta(days=2),
                )
            )

    # Open vacancy records for currently vacant beds
    for code, bed in beds_by_code.items():
        if bed.status == BedStatus.VACANT:
            db.add(
                VacancyRecord(
                    pg_id=pg.id,
                    bed_id=bed.id,
                    vacant_from=bed.vacant_since or now,
                    monthly_rent_snapshot=bed.monthly_rent,
                    status=VacancyStatus.OPEN,
                )
            )

    # Sample complaints
    c1 = Complaint(
        tenant_id=created_tenants[0].id,
        pg_id=pg.id,
        room_id=created_tenants[0].room_id,
        bed_id=created_tenants[0].bed_id,
        room_number_snapshot=created_tenants[0].room.room_number if created_tenants[0].room else "101",
        bed_code_snapshot=created_tenants[0].bed.bed_code if created_tenants[0].bed else "101-A",
        category=ComplaintCategory.AC,
        title="AC not cooling properly",
        description="Cooling drops noticeably after midnight.",
        status=ComplaintStatus.IN_PROGRESS,
        manager_remarks="Technician scheduled for evening inspection.",
        assigned_manager_id=manager.id,
        submitted_at=now - timedelta(hours=14),
        viewed_at=now - timedelta(hours=12),
        in_progress_at=now - timedelta(hours=6),
    )
    db.add(c1)
    db.flush()
    db.add_all(
        [
            ComplaintHistory(
                complaint_id=c1.id,
                old_status=None,
                new_status=ComplaintStatus.SUBMITTED.value,
                remarks="Complaint submitted by tenant.",
                changed_by=created_tenants[0].user_id,
                changed_at=c1.submitted_at,
            ),
            ComplaintHistory(
                complaint_id=c1.id,
                old_status=ComplaintStatus.SUBMITTED.value,
                new_status=ComplaintStatus.VIEWED_BY_MANAGER.value,
                remarks="Reviewed by manager.",
                changed_by=manager.id,
                changed_at=c1.viewed_at,
            ),
            ComplaintHistory(
                complaint_id=c1.id,
                old_status=ComplaintStatus.VIEWED_BY_MANAGER.value,
                new_status=ComplaintStatus.IN_PROGRESS.value,
                remarks="Technician scheduled for evening inspection.",
                changed_by=manager.id,
                changed_at=c1.in_progress_at,
            ),
        ]
    )

    c2 = Complaint(
        tenant_id=created_tenants[1].id,
        pg_id=pg.id,
        room_id=created_tenants[1].room_id,
        bed_id=created_tenants[1].bed_id,
        room_number_snapshot=created_tenants[1].room.room_number if created_tenants[1].room else "101",
        bed_code_snapshot=created_tenants[1].bed.bed_code if created_tenants[1].bed else "101-B",
        category=ComplaintCategory.WIFI,
        title="WiFi slow in Room 101",
        description="Frequent packet drops during video calls.",
        status=ComplaintStatus.SUBMITTED,
        submitted_at=now - timedelta(hours=3),
    )
    db.add(c2)
    db.flush()
    db.add(
        ComplaintHistory(
            complaint_id=c2.id,
            old_status=None,
            new_status=ComplaintStatus.SUBMITTED.value,
            remarks="Complaint submitted by tenant.",
            changed_by=created_tenants[1].user_id,
            changed_at=c2.submitted_at,
        )
    )

    # Seed Monday-Sunday Food Menu
    weekly_items = {
        DayOfWeek.MONDAY: ("Poha, Sev & Masala Chai", "Rajma Chawal, Roti, Salad", "Paneer Butter Masala, Dal, Roti, Kheer"),
        DayOfWeek.TUESDAY: ("Aloo Paratha, Curd & Pickle", "Chole, Jeera Rice, Boondi Raita", "Mix Veg, Dal Fry, Tawa Roti"),
        DayOfWeek.WEDNESDAY: ("Idli, Sambhar & Coconut Chutney", "Kadhi Pakora, Steamed Rice, Roti", "Egg Curry / Matar Paneer, Dal, Roti"),
        DayOfWeek.THURSDAY: ("Upma, Boiled Egg / Sprouts, Tea", "Dal Makhani, Veg Pulao, Salad", "Aloo Gobhi, Moong Dal, Roti, Gulab Jamun"),
        DayOfWeek.FRIDAY: ("Bread Omelette / Paneer Sandwich, Milk", "Veg Biryani, Mirchi Salan, Raita", "Palak Paneer, Dal Tadka, Roti"),
        DayOfWeek.SATURDAY: ("Chole Bhature & Lassi", "Khichdi, Kadhi, Papad, Salad", "Bhindi Masala, Arhar Dal, Roti"),
        DayOfWeek.SUNDAY: ("Masala Dosa, Sambhar & Filter Coffee", "Special Thali: Pulao, Paneer, Sweet", "Light Veg Soup, Dal Khichdi, Curd"),
    }
    for day, (bf, ln, dn) in weekly_items.items():
        for meal, desc, timing in [
            (MealType.BREAKFAST, bf, pg.breakfast_timing),
            (MealType.LUNCH, ln, pg.lunch_timing),
            (MealType.DINNER, dn, pg.dinner_timing),
        ]:
            slot = FoodMenu(
                pg_id=pg.id,
                day_of_week=day,
                meal_type=meal,
                meal_name=f"{day.value.title()} {meal.value.title()}",
                description=f"Freshly prepared home-style {meal.value} for {day.value.title()}.",
                items_description=desc,
                timing_label=timing,
                is_available=True,
                is_published=True,
                updated_by=manager.id,
            )
            db.add(slot)
            db.flush()
            for idx_item, part in enumerate(desc.split(",")):
                clean_part = part.strip()
                if clean_part:
                    db.add(
                        FoodMenuItem(
                            food_menu_id=slot.id,
                            item_name=clean_part[:120],
                            is_veg=True,
                            sort_order=idx_item,
                        )
                    )

    db.commit()
    return {"status": "seeded", "pg_name": pg.name}


if __name__ == "__main__":
    with SessionLocal() as session:
        result = seed_database(session)
        print(result)

