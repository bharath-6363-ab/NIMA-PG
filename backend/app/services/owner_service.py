import calendar
import csv
import io
import secrets
import urllib.parse
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import ensure_utc
from app.core.security import hash_password, normalize_mobile
from app.models.complaint import Complaint
from app.models.enums import (
    BedStatus,
    DepositStatus,
    NotificationType,
    PaymentMethod,
    PaymentStatus,
    RentStatus,
    SharingType,
    TenantStatus,
    UserRole,
    VacancyStatus,
)
from app.models.finance import Payment, RentRecord, SecurityDeposit
from app.models.notification import Notification
from app.models.property import Bed, PGProperty, Room, VacancyRecord, VacancyShareLink
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    BedVacancyOut,
    FinancialDepositReportRowOut,
    FinancialReportRowOut,
    ManagerCreateIn,
    ManagerOut,
    ManagerUpdateIn,
    ManualPaymentIn,
    MonthlyTrendPoint,
    OwnerActivityItem,
    OwnerFinanceDashboardOut,
    OwnerFinancialReportsOut,
    OwnerPendingRentRow,
    OwnerRecentCheckoutRow,
    OwnerRecentComplaintRow,
    OwnerRecentTenantRow,
    OwnerTransactionRow,
    OwnerVacancyDashboardOut,
    PGSettingsUpdateIn,
    PaymentOut,
    PropertySummaryOut,
    PublicVacancyBedOut,
    PublicVacancyPageOut,
    RoomCreateIn,
    RoomUpdateIn,
    VacancyShareLinkCreateIn,
    VacancyShareLinkOut,
)
from app.services.payment_service import (
    ensure_rent_record_for_period,
    sync_rent_record_status,
    to_payment_out,
)
from app.services.receipt_pdf import build_simple_pdf


def _list_owned_pgs(db: Session, owner_user: User) -> list[PGProperty]:
    pgs = db.scalars(
        select(PGProperty)
        .where(PGProperty.owner_id == owner_user.id)
        .order_by(PGProperty.id.asc())
    ).all()
    if not pgs and owner_user.pg_id is not None:
        fallback = db.get(PGProperty, owner_user.pg_id)
        if fallback is not None:
            pgs = [fallback]
    return list(pgs)


def get_owner_pg(db: Session, owner_user: User, pg_id: int | None = None) -> PGProperty:
    pgs = _list_owned_pgs(db, owner_user)
    if not pgs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PG property not found.")
    if pg_id is not None:
        match = next((p for p in pgs if p.id == pg_id), None)
        if match is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this PG property.",
            )
        return match
    return pgs[0]


def _build_property_summaries(db: Session, pgs: list[PGProperty]) -> list[PropertySummaryOut]:
    summaries: list[PropertySummaryOut] = []
    for prop in pgs:
        rooms = db.scalars(
            select(Room).where(Room.pg_id == prop.id, Room.is_active.is_(True))
        ).all()
        room_ids = [r.id for r in rooms]
        beds = (
            db.scalars(
                select(Bed).where(Bed.pg_id == prop.id, Bed.room_id.in_(room_ids))
            ).all()
            if room_ids
            else []
        )
        total_beds = len(beds)
        occ = sum(1 for b in beds if b.status in (BedStatus.OCCUPIED, BedStatus.NOTICE_PERIOD))
        vac = sum(1 for b in beds if b.status == BedStatus.VACANT)
        occ_pct = round((occ / total_beds) * 100.0, 1) if total_beds > 0 else 0.0
        summaries.append(
            PropertySummaryOut(
                id=prop.id,
                name=prop.name,
                city=prop.city,
                total_rooms=len(rooms),
                total_beds=total_beds,
                occupied_beds=occ,
                vacant_beds=vac,
                occupancy_percentage=occ_pct,
            )
        )
    return summaries


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    total = year * 12 + (month - 1) + delta
    return total // 12, (total % 12) + 1


def _compute_deposits_held_total(db: Session, pg_id: int) -> Decimal:
    deposits = db.scalars(
        select(SecurityDeposit).where(
            SecurityDeposit.pg_id == pg_id,
            SecurityDeposit.paid_status != DepositStatus.REFUNDED,
        )
    ).all()
    total = Decimal("0.00")
    for d in deposits:
        net = Decimal(d.amount_held) - Decimal(d.deduction_amount) - Decimal(d.refund_amount)
        if net > Decimal("0.00"):
            total += net
    return total


def get_financial_dashboard(
    db: Session,
    *,
    pg: PGProperty,
    owner_user: User | None = None,
    month: int,
    year: int,
    search: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> OwnerFinanceDashboardOut:
    if (start_date is not None) != (end_date is not None):
        raise HTTPException(
            status_code=422,
            detail="Both start_date and end_date must be provided together.",
        )
    if start_date is not None and end_date is not None and end_date < start_date:
        raise HTTPException(
            status_code=422,
            detail="end_date cannot precede start_date.",
        )

    today = date.today()
    using_custom_range = start_date is not None and end_date is not None

    if not using_custom_range and (year, month) == (today.year, today.month):
        active_tenants_for_gen = db.scalars(
            select(Tenant).where(
                Tenant.pg_id == pg.id,
                Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
            )
        ).all()
        for t in active_tenants_for_gen:
            ensure_rent_record_for_period(db, tenant=t, pg=pg, year=year, month=month)
        db.commit()

    if using_custom_range:
        assert start_date is not None and end_date is not None
        records = db.scalars(
            select(RentRecord).where(
                RentRecord.pg_id == pg.id,
                RentRecord.due_date >= start_date,
                RentRecord.due_date <= end_date,
            )
        ).all()
    else:
        records = db.scalars(
            select(RentRecord).where(
                RentRecord.pg_id == pg.id,
                RentRecord.billing_year == year,
                RentRecord.billing_month == month,
            )
        ).all()

    total_expected = Decimal("0.00")
    total_collected = Decimal("0.00")
    total_pending = Decimal("0.00")
    total_overdue = Decimal("0.00")
    paid_count = 0
    pending_count = 0
    overdue_count = 0
    pending_rows: list[OwnerPendingRentRow] = []

    search_lower = search.strip().lower() if search else None

    for rec in records:
        sync_rent_record_status(rec, today=today)
        total_expected += Decimal(rec.total_amount)
        if not using_custom_range:
            total_collected += Decimal(rec.amount_paid)
        balance = max(Decimal("0.00"), Decimal(rec.total_amount) - Decimal(rec.amount_paid))

        if rec.status == RentStatus.PAID:
            paid_count += 1
        else:
            pending_count += 1
            total_pending += balance
            days_late = max(0, (today - rec.due_date).days) if today > rec.due_date else 0
            if rec.status == RentStatus.OVERDUE:
                overdue_count += 1
                total_overdue += balance

            tenant = db.get(Tenant, rec.tenant_id)
            room = db.get(Room, tenant.room_id) if tenant else None
            bed = db.get(Bed, tenant.bed_id) if tenant else None
            t_name = tenant.full_name if tenant else "Tenant"
            r_num = rec.room_number_snapshot or (room.room_number if room else "-")
            b_code = rec.bed_code_snapshot or (bed.bed_code if bed else "-")

            if search_lower:
                hay = f"{t_name} {r_num} {b_code}".lower()
                if search_lower not in hay:
                    continue

            pending_rows.append(
                OwnerPendingRentRow(
                    rent_record_id=rec.id,
                    tenant_id=rec.tenant_id,
                    tenant_name=t_name,
                    tenant_mobile=tenant.mobile if tenant else "",
                    room_number=r_num,
                    bed_code=b_code,
                    total_amount=rec.total_amount,
                    amount_paid=rec.amount_paid,
                    balance_due=balance,
                    due_date=rec.due_date,
                    days_overdue=days_late,
                    status=rec.status,
                    reminder_sent_at=rec.reminder_sent_at,
                )
            )

    pending_rows.sort(key=lambda r: (-r.days_overdue, r.room_number, r.tenant_name))

    # Payments for recent transactions (and custom range collection sum)
    all_verified_payments = db.scalars(
        select(Payment)
        .where(Payment.pg_id == pg.id, Payment.status == PaymentStatus.VERIFIED_PAID)
        .order_by(Payment.paid_at.desc(), Payment.id.desc())
    ).all()

    if using_custom_range:
        assert start_date is not None and end_date is not None
        range_start = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        range_end = datetime.combine(end_date, time.max, tzinfo=timezone.utc)
        filtered_payments = [
            p
            for p in all_verified_payments
            if p.paid_at is not None and range_start <= ensure_utc(p.paid_at) <= range_end
        ]
        total_collected = sum((Decimal(p.amount) for p in filtered_payments), Decimal("0.00"))
        payments_for_recent = filtered_payments[:15]
    else:
        payments_for_recent = all_verified_payments[:15]

    recent_transactions: list[OwnerTransactionRow] = []
    for p in payments_for_recent:
        tenant = db.get(Tenant, p.tenant_id)
        room = db.get(Room, tenant.room_id) if tenant else None
        bed = db.get(Bed, tenant.bed_id) if tenant else None
        recent_transactions.append(
            OwnerTransactionRow(
                payment_id=p.id,
                receipt_number=p.receipt_number,
                tenant_id=p.tenant_id,
                tenant_name=tenant.full_name if tenant else "Tenant",
                room_number=room.room_number if room else "-",
                bed_code=bed.bed_code if bed else "-",
                amount=p.amount,
                payment_method=p.payment_method,
                status=p.status,
                paid_at=p.paid_at,
            )
        )

    # Property & bed occupancy overview
    active_rooms = db.scalars(
        select(Room).where(Room.pg_id == pg.id, Room.is_active.is_(True))
    ).all()
    room_ids = [r.id for r in active_rooms]
    beds = (
        db.scalars(select(Bed).where(Bed.pg_id == pg.id, Bed.room_id.in_(room_ids))).all()
        if room_ids
        else []
    )
    total_beds = len(beds)
    occupied_beds = sum(1 for b in beds if b.status in (BedStatus.OCCUPIED, BedStatus.NOTICE_PERIOD))
    vacant_beds = sum(1 for b in beds if b.status == BedStatus.VACANT)
    notice_beds = sum(1 for b in beds if b.status == BedStatus.NOTICE_PERIOD)
    maint_beds = sum(1 for b in beds if b.status == BedStatus.MAINTENANCE)
    occupancy_percentage = round((occupied_beds / total_beds) * 100.0, 1) if total_beds > 0 else 0.0

    owned_pgs = _list_owned_pgs(db, owner_user) if owner_user else [pg]
    if all(p.id != pg.id for p in owned_pgs):
        owned_pgs = [pg, *owned_pgs]
    prop_summaries = _build_property_summaries(db, owned_pgs)

    # Security deposits held (strictly separate from rent)
    total_deposits = _compute_deposits_held_total(db, pg.id)

    # Tenant overview & recent activity
    active_tenants = db.scalars(
        select(Tenant)
        .where(
            Tenant.pg_id == pg.id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
        .order_by(Tenant.joining_date.desc(), Tenant.id.desc())
    ).all()

    recent_reg_rows: list[OwnerRecentTenantRow] = []
    for t in active_tenants[:5]:
        r = db.get(Room, t.room_id)
        b = db.get(Bed, t.bed_id)
        recent_reg_rows.append(
            OwnerRecentTenantRow(
                id=t.id,
                full_name=t.full_name,
                room_number=r.room_number if r else "-",
                bed_code=b.bed_code if b else "-",
                joining_date=t.joining_date,
                monthly_rent=t.monthly_rent,
                status=t.status,
            )
        )

    recent_cmp_objs = db.scalars(
        select(Complaint)
        .where(Complaint.pg_id == pg.id)
        .order_by(Complaint.updated_at.desc(), Complaint.id.desc())
        .limit(5)
    ).all()
    recent_complaints: list[OwnerRecentComplaintRow] = []
    for c in recent_cmp_objs:
        t = db.get(Tenant, c.tenant_id)
        r = db.get(Room, c.room_id)
        recent_complaints.append(
            OwnerRecentComplaintRow(
                id=c.id,
                title=c.title,
                category=c.category,
                status=c.status,
                tenant_name=t.full_name if t else "Tenant",
                room_number=c.room_number_snapshot or (r.room_number if r else "-"),
                updated_at=c.updated_at,
            )
        )

    recent_checkout_objs = db.scalars(
        select(Tenant)
        .where(Tenant.pg_id == pg.id, Tenant.status == TenantStatus.CHECKED_OUT)
        .order_by(Tenant.leaving_date.desc(), Tenant.updated_at.desc())
        .limit(5)
    ).all()
    recent_checkouts: list[OwnerRecentCheckoutRow] = []
    for t in recent_checkout_objs:
        r = db.get(Room, t.room_id)
        b = db.get(Bed, t.bed_id)
        recent_checkouts.append(
            OwnerRecentCheckoutRow(
                id=t.id,
                full_name=t.full_name,
                room_number=r.room_number if r else "-",
                bed_code=b.bed_code if b else "-",
                leaving_date=t.leaving_date,
                checkout_remarks=t.checkout_remarks,
            )
        )

    # Combined recent activity feed
    activity: list[OwnerActivityItem] = []
    for tx in recent_transactions[:5]:
        ts = ensure_utc(tx.paid_at) if tx.paid_at else datetime.now(timezone.utc)
        activity.append(
            OwnerActivityItem(
                activity_type="payment",
                title=f"Payment received from {tx.tenant_name}",
                subtitle=f"Room {tx.room_number} · {tx.bed_code} · {tx.payment_method.value.replace('_', ' ').upper()}",
                timestamp=ts,
                amount=tx.amount,
            )
        )
    for t in active_tenants[:5]:
        r = db.get(Room, t.room_id)
        b = db.get(Bed, t.bed_id)
        activity.append(
            OwnerActivityItem(
                activity_type="registration",
                title=f"Tenant registered: {t.full_name}",
                subtitle=f"Room {r.room_number if r else '-'} · {b.bed_code if b else '-'} · Joined {t.joining_date.isoformat()}",
                timestamp=ensure_utc(t.created_at),
                amount=t.monthly_rent,
            )
        )
    for cmp_row in recent_complaints[:5]:
        activity.append(
            OwnerActivityItem(
                activity_type="complaint",
                title=f"Complaint {cmp_row.status.value.replace('_', ' ')}: {cmp_row.title}",
                subtitle=f"Room {cmp_row.room_number} · {cmp_row.tenant_name}",
                timestamp=ensure_utc(cmp_row.updated_at),
            )
        )
    for co in recent_checkouts[:5]:
        co_ts = (
            datetime.combine(co.leaving_date, time(12, 0), tzinfo=timezone.utc)
            if co.leaving_date
            else datetime.now(timezone.utc)
        )
        activity.append(
            OwnerActivityItem(
                activity_type="checkout",
                title=f"Checkout completed: {co.full_name}",
                subtitle=f"Room {co.room_number} · {co.bed_code}",
                timestamp=co_ts,
            )
        )
    activity.sort(key=lambda a: a.timestamp, reverse=True)

    # 6-month trend anchored at selected month/year
    trend: list[MonthlyTrendPoint] = []
    for delta in range(-5, 1):
        ty, tm = _shift_month(year, month, delta)
        m_recs = db.scalars(
            select(RentRecord).where(
                RentRecord.pg_id == pg.id,
                RentRecord.billing_year == ty,
                RentRecord.billing_month == tm,
            )
        ).all()
        trend.append(
            MonthlyTrendPoint(
                label=f"{calendar.month_abbr[tm]} {str(ty)[2:]}",
                month=tm,
                year=ty,
                expected=sum((Decimal(r.total_amount) for r in m_recs), Decimal("0.00")),
                collected=sum((Decimal(r.amount_paid) for r in m_recs), Decimal("0.00")),
            )
        )

    return OwnerFinanceDashboardOut(
        pg_id=pg.id,
        pg_name=pg.name,
        month=month,
        year=year,
        start_date=start_date,
        end_date=end_date,
        total_properties=len(prop_summaries),
        properties=prop_summaries,
        total_rooms=len(active_rooms),
        occupied_beds=occupied_beds,
        vacant_beds=vacant_beds,
        notice_period_beds=notice_beds,
        maintenance_beds=maint_beds,
        total_beds=total_beds,
        occupancy_percentage=occupancy_percentage,
        total_active_tenants=len(active_tenants),
        total_expected_rent=total_expected,
        total_collected_rent=total_collected,
        total_pending_rent=total_pending,
        total_overdue_rent=total_overdue,
        paid_tenants_count=paid_count,
        pending_tenants_count=pending_count,
        overdue_tenants_count=overdue_count,
        total_security_deposits_held=total_deposits,
        pending_tenants=pending_rows,
        recent_transactions=recent_transactions,
        recently_registered_tenants=recent_reg_rows,
        recent_complaints=recent_complaints,
        recent_checkouts=recent_checkouts,
        recent_activity=activity[:10],
        monthly_trend=trend,
    )


def get_financial_reports_data(
    db: Session,
    *,
    pg: PGProperty,
    month: int,
    year: int,
    search: str | None = None,
    status_filter: RentStatus | None = None,
    payment_method: PaymentMethod | None = None,
) -> OwnerFinancialReportsOut:
    today = date.today()
    records = db.scalars(
        select(RentRecord)
        .where(
            RentRecord.pg_id == pg.id,
            RentRecord.billing_year == year,
            RentRecord.billing_month == month,
        )
        .order_by(RentRecord.id.asc())
    ).all()

    search_lower = search.strip().lower() if search else None

    total_expected = Decimal("0.00")
    total_collected = Decimal("0.00")
    total_pending = Decimal("0.00")
    total_overdue = Decimal("0.00")

    collection_rows: list[FinancialReportRowOut] = []
    pending_rows: list[FinancialReportRowOut] = []
    overdue_rows: list[FinancialReportRowOut] = []

    for rec in records:
        sync_rent_record_status(rec, today=today)
        bal = max(Decimal("0.00"), Decimal(rec.total_amount) - Decimal(rec.amount_paid))
        total_expected += Decimal(rec.total_amount)
        total_collected += Decimal(rec.amount_paid)
        if bal > Decimal("0.00"):
            total_pending += bal
            if rec.status == RentStatus.OVERDUE:
                total_overdue += bal

        t = db.get(Tenant, rec.tenant_id)
        r = db.get(Room, t.room_id) if t else None
        b = db.get(Bed, t.bed_id) if t else None
        t_name = t.full_name if t else "Tenant"
        t_mobile = t.mobile if t else ""
        r_num = rec.room_number_snapshot or (r.room_number if r else "-")
        b_code = rec.bed_code_snapshot or (b.bed_code if b else "-")

        if search_lower:
            hay = f"{t_name} {t_mobile} {r_num} {b_code}".lower()
            if search_lower not in hay:
                continue
        if status_filter is not None and rec.status != status_filter:
            continue

        row = FinancialReportRowOut(
            rent_record_id=rec.id,
            tenant_id=rec.tenant_id,
            tenant_name=t_name,
            tenant_mobile=t_mobile,
            room_number=r_num,
            bed_code=b_code,
            billing_month=rec.billing_month,
            billing_year=rec.billing_year,
            base_rent=rec.base_rent,
            food_charges=rec.food_charges,
            other_charges=rec.other_charges,
            total_amount=rec.total_amount,
            amount_paid=rec.amount_paid,
            balance_due=bal,
            due_date=rec.due_date,
            days_overdue=max(0, (today - rec.due_date).days) if bal > 0 and today > rec.due_date else 0,
            status=rec.status,
        )
        collection_rows.append(row)
        if bal > Decimal("0.00"):
            pending_rows.append(row)
            if rec.status == RentStatus.OVERDUE:
                overdue_rows.append(row)

    db.commit()

    # Verified payment history for this billing month OR paid during month/year
    all_payments = db.scalars(
        select(Payment)
        .where(Payment.pg_id == pg.id, Payment.status == PaymentStatus.VERIFIED_PAID)
        .order_by(Payment.paid_at.desc(), Payment.id.desc())
    ).all()
    rec_id_set = {rec.id for rec in records}
    payment_rows: list[PaymentOut] = []
    for p in all_payments:
        in_period = p.rent_record_id in rec_id_set or (
            p.paid_at is not None and p.paid_at.year == year and p.paid_at.month == month
        )
        if not in_period:
            continue
        if payment_method is not None and p.payment_method != payment_method:
            continue
        p_out = to_payment_out(db, p)
        if search_lower:
            hay = f"{p_out.tenant_name} {p_out.room_number} {p_out.bed_code} {p_out.receipt_number or ''}".lower()
            if search_lower not in hay:
                continue
        payment_rows.append(p_out)

    # Security deposit summary (separated from rent!)
    deposits = db.scalars(
        select(SecurityDeposit)
        .where(SecurityDeposit.pg_id == pg.id)
        .order_by(SecurityDeposit.id.desc())
    ).all()
    total_dep_held = Decimal("0.00")
    total_dep_deductions = Decimal("0.00")
    total_dep_refunds = Decimal("0.00")
    deposit_rows: list[FinancialDepositReportRowOut] = []

    for d in deposits:
        net_bal = max(
            Decimal("0.00"),
            Decimal(d.amount_held) - Decimal(d.deduction_amount) - Decimal(d.refund_amount),
        )
        if d.paid_status != DepositStatus.REFUNDED:
            total_dep_held += net_bal
        total_dep_deductions += Decimal(d.deduction_amount)
        total_dep_refunds += Decimal(d.refund_amount)

        t = db.get(Tenant, d.tenant_id)
        r = db.get(Room, t.room_id) if t else None
        b = db.get(Bed, t.bed_id) if t else None
        t_name = t.full_name if t else "Tenant"
        t_mobile = t.mobile if t else ""
        r_num = r.room_number if r else "-"
        b_code = b.bed_code if b else "-"

        if search_lower:
            hay = f"{t_name} {t_mobile} {r_num} {b_code}".lower()
            if search_lower not in hay:
                continue

        deposit_rows.append(
            FinancialDepositReportRowOut(
                tenant_id=d.tenant_id,
                tenant_name=t_name,
                tenant_mobile=t_mobile,
                room_number=r_num,
                bed_code=b_code,
                tenant_status=t.status if t else TenantStatus.ACTIVE,
                amount_held=d.amount_held,
                deduction_amount=d.deduction_amount,
                refund_amount=d.refund_amount,
                refundable_balance=net_bal,
                paid_status=d.paid_status,
            )
        )

    collection_rate = (
        round(float(total_collected / total_expected) * 100.0, 1)
        if total_expected > Decimal("0.00")
        else 0.0
    )

    return OwnerFinancialReportsOut(
        pg_id=pg.id,
        pg_name=pg.name,
        month=month,
        year=year,
        collection_rate_percentage=collection_rate,
        total_expected_rent=total_expected,
        total_collected_rent=total_collected,
        total_pending_rent=total_pending,
        total_overdue_rent=total_overdue,
        total_security_deposits_held=total_dep_held,
        total_deposit_deductions=total_dep_deductions,
        total_deposit_refunds=total_dep_refunds,
        monthly_collection_rows=collection_rows,
        pending_rent_rows=pending_rows,
        overdue_rent_rows=overdue_rows,
        payment_history_rows=payment_rows,
        security_deposit_rows=deposit_rows,
    )


def get_tenant_financial_history(db: Session, *, pg: PGProperty, tenant_id: int) -> dict:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or tenant.pg_id != pg.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    room = db.get(Room, tenant.room_id)
    bed = db.get(Bed, tenant.bed_id)
    records = db.scalars(
        select(RentRecord)
        .where(RentRecord.tenant_id == tenant.id)
        .order_by(RentRecord.billing_year.desc(), RentRecord.billing_month.desc())
    ).all()
    payments = db.scalars(
        select(Payment)
        .where(Payment.tenant_id == tenant.id, Payment.status == PaymentStatus.VERIFIED_PAID)
        .order_by(Payment.paid_at.desc())
    ).all()
    deposit = db.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant.id))
    return {
        "tenant_id": tenant.id,
        "full_name": tenant.full_name,
        "mobile": tenant.mobile,
        "room_number": room.room_number if room else "-",
        "bed_code": bed.bed_code if bed else "-",
        "status": tenant.status.value,
        "security_deposit": {
            "amount_held": str(deposit.amount_held) if deposit else "0.00",
            "paid_status": deposit.paid_status.value if deposit else "pending",
            "deduction_amount": str(deposit.deduction_amount) if deposit else "0.00",
            "refund_amount": str(deposit.refund_amount) if deposit else "0.00",
        },
        "rent_records": [
            {
                "id": r.id,
                "billing_month": r.billing_month,
                "billing_year": r.billing_year,
                "base_rent": str(r.base_rent),
                "food_charges": str(r.food_charges),
                "other_charges": str(r.other_charges),
                "total_amount": str(r.total_amount),
                "amount_paid": str(r.amount_paid),
                "due_date": r.due_date.isoformat(),
                "status": r.status.value,
            }
            for r in records
        ],
        "payments": [
            {
                "id": p.id,
                "receipt_number": p.receipt_number,
                "amount": str(p.amount),
                "payment_method": p.payment_method.value,
                "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            }
            for p in payments
        ],
    }


def send_rent_reminder(db: Session, *, pg: PGProperty, rent_record_id: int) -> dict:
    rec = db.get(RentRecord, rent_record_id)
    if rec is None or rec.pg_id != pg.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rent record not found.")

    balance = max(Decimal("0.00"), Decimal(rec.total_amount) - Decimal(rec.amount_paid))
    if balance <= Decimal("0.00"):
        raise HTTPException(status_code=400, detail="Rent for this period is already paid.")

    tenant = db.get(Tenant, rec.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    now = datetime.now(timezone.utc)
    rec.reminder_sent_at = now
    period = f"{calendar.month_name[rec.billing_month]} {rec.billing_year}"
    msg = (
        f"Hello {tenant.full_name}, reminder for {pg.name}: "
        f"Your rent of Rs. {balance} for {period} was due on {rec.due_date.strftime('%d %b %Y')}. "
        f"Please complete payment via the Aapka PG app."
    )

    db.add(
        Notification(
            user_id=tenant.user_id,
            pg_id=pg.id,
            notif_type=NotificationType.RENT_REMINDER,
            title=f"Rent Reminder - {period}",
            message=msg,
        )
    )
    db.commit()

    clean_digits = "".join(ch for ch in tenant.mobile if ch.isdigit())
    wa_url = f"https://wa.me/{clean_digits}?text={urllib.parse.quote(msg)}"
    return {
        "rent_record_id": rec.id,
        "reminder_sent_at": now.isoformat(),
        "message": "Rent reminder sent to tenant notifications.",
        "whatsapp_url": wa_url,
    }


def record_manual_payment(
    db: Session,
    *,
    pg: PGProperty,
    actor: User,
    body: ManualPaymentIn,
) -> OwnerTransactionRow:
    rec = db.get(RentRecord, body.rent_record_id)
    if rec is None or rec.pg_id != pg.id:
        raise HTTPException(status_code=404, detail="Rent record not found.")

    balance = max(Decimal("0.00"), Decimal(rec.total_amount) - Decimal(rec.amount_paid))
    if body.amount > balance:
        raise HTTPException(status_code=422, detail=f"Amount exceeds remaining balance ({balance}).")

    now = datetime.now(timezone.utc)
    payment = Payment(
        rent_record_id=rec.id,
        tenant_id=rec.tenant_id,
        pg_id=pg.id,
        amount=body.amount,
        payment_method=body.payment_method,
        gateway_provider="manual_verified",
        gateway_order_id=f"manual_{secrets.token_hex(8)}",
        gateway_payment_id=f"man_pay_{secrets.token_hex(6)}",
        status=PaymentStatus.VERIFIED_PAID,
        paid_at=now,
        recorded_by=actor.id,
        notes=body.notes,
    )
    db.add(payment)
    db.flush()
    payment.receipt_number = f"RCPT-{rec.billing_year}{rec.billing_month:02d}-{payment.id:05d}"

    rec.amount_paid = Decimal(rec.amount_paid) + Decimal(body.amount)
    sync_rent_record_status(rec)

    tenant = db.get(Tenant, rec.tenant_id)
    room = db.get(Room, tenant.room_id) if tenant else None
    bed = db.get(Bed, tenant.bed_id) if tenant else None
    if tenant:
        db.add(
            Notification(
                user_id=tenant.user_id,
                pg_id=pg.id,
                notif_type=NotificationType.PAYMENT_RECEIPT,
                title=f"Rent Receipt {payment.receipt_number}",
                message=f"Payment of INR {payment.amount} recorded by PG Owner.",
            )
        )
    db.commit()
    db.refresh(payment)

    return OwnerTransactionRow(
        payment_id=payment.id,
        receipt_number=payment.receipt_number,
        tenant_id=payment.tenant_id,
        tenant_name=tenant.full_name if tenant else "Tenant",
        room_number=room.room_number if room else "-",
        bed_code=bed.bed_code if bed else "-",
        amount=payment.amount,
        payment_method=payment.payment_method,
        status=payment.status,
        paid_at=payment.paid_at,
    )


def build_monthly_financial_report(
    db: Session,
    *,
    pg: PGProperty,
    month: int,
    year: int,
    fmt: str = "csv",
    report_type: str = "collection",
    search: str | None = None,
) -> tuple[bytes, str, str]:
    reports = get_financial_reports_data(
        db,
        pg=pg,
        month=month,
        year=year,
        search=search,
    )
    period_label = f"{calendar.month_name[month]} {year}"
    rt = report_type.lower().strip()

    if fmt.lower() == "pdf":
        lines = [
            f"PG Property: {pg.name} ({pg.city})",
            f"Billing Period: {period_label}",
            f"Report Type: {rt.title()}",
            "------------------------------------------------------------------",
            f"Total Expected Rent      : INR {reports.total_expected_rent}",
            f"Total Collected Rent     : INR {reports.total_collected_rent} ({reports.collection_rate_percentage}%)",
            f"Total Pending Rent       : INR {reports.total_pending_rent}",
            f"Total Overdue Rent       : INR {reports.total_overdue_rent}",
            f"Security Deposits Held   : INR {reports.total_security_deposits_held} (Separate Ledger)",
            "------------------------------------------------------------------",
        ]
        if rt == "payments":
            lines.append("Payment History:")
            for p in reports.payment_history_rows[:25]:
                lines.append(
                    f"- {p.receipt_number or p.id} | {p.tenant_name} ({p.bed_code}): "
                    f"INR {p.amount} via {p.payment_method.value}"
                )
        elif rt == "deposits":
            lines.append("Security Deposit Summary:")
            for d in reports.security_deposit_rows[:25]:
                lines.append(
                    f"- {d.tenant_name} ({d.bed_code}): Held {d.amount_held} | "
                    f"Deducted {d.deduction_amount} | Refunded {d.refund_amount} | Bal {d.refundable_balance}"
                )
        else:
            target_rows = (
                reports.pending_rent_rows
                if rt == "pending"
                else reports.overdue_rent_rows
                if rt == "overdue"
                else reports.monthly_collection_rows
            )
            lines.append("Tenant Rent Breakdown:")
            for row in target_rows[:25]:
                lines.append(
                    f"- {row.tenant_name} ({row.bed_code}): Due {row.total_amount} | "
                    f"Paid {row.amount_paid} | Bal {row.balance_due} [{row.status.value}]"
                )
        pdf_bytes = build_simple_pdf(f"Financial Report ({rt.title()}) - {period_label}", lines)
        return pdf_bytes, "application/pdf", f"financial-{rt}-{year}-{month:02d}.pdf"

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["PG Name", pg.name])
    writer.writerow(["Billing Period", period_label])
    writer.writerow(["Report Type", rt])
    writer.writerow(["Total Expected Rent", str(reports.total_expected_rent)])
    writer.writerow(["Total Collected Rent", str(reports.total_collected_rent)])
    writer.writerow(["Total Pending Rent", str(reports.total_pending_rent)])
    writer.writerow(["Total Overdue Rent", str(reports.total_overdue_rent)])
    writer.writerow(["Total Security Deposits Held", str(reports.total_security_deposits_held)])
    writer.writerow([])

    if rt == "payments":
        writer.writerow(["Receipt Number", "Tenant Name", "Room", "Bed", "Method", "Amount", "Paid At"])
        for p in reports.payment_history_rows:
            writer.writerow(
                [
                    p.receipt_number or f"PAY-{p.id}",
                    p.tenant_name,
                    p.room_number,
                    p.bed_code,
                    p.payment_method.value,
                    str(p.amount),
                    p.paid_at.isoformat() if p.paid_at else "",
                ]
            )
    elif rt == "deposits":
        writer.writerow(
            [
                "Tenant Name",
                "Mobile",
                "Room",
                "Bed",
                "Tenant Status",
                "Held",
                "Deductions",
                "Refunded",
                "Refundable Balance",
                "Deposit Status",
            ]
        )
        for d in reports.security_deposit_rows:
            writer.writerow(
                [
                    d.tenant_name,
                    d.tenant_mobile,
                    d.room_number,
                    d.bed_code,
                    d.tenant_status.value,
                    str(d.amount_held),
                    str(d.deduction_amount),
                    str(d.refund_amount),
                    str(d.refundable_balance),
                    d.paid_status.value,
                ]
            )
    else:
        target_rows = (
            reports.pending_rent_rows
            if rt == "pending"
            else reports.overdue_rent_rows
            if rt == "overdue"
            else reports.monthly_collection_rows
        )
        writer.writerow(
            [
                "Tenant Name",
                "Mobile",
                "Room",
                "Bed",
                "Base Rent",
                "Food Charges",
                "Other Charges",
                "Total Due",
                "Amount Paid",
                "Balance Due",
                "Due Date",
                "Days Overdue",
                "Status",
            ]
        )
        for row in target_rows:
            writer.writerow(
                [
                    row.tenant_name,
                    row.tenant_mobile,
                    row.room_number,
                    row.bed_code,
                    str(row.base_rent),
                    str(row.food_charges),
                    str(row.other_charges),
                    str(row.total_amount),
                    str(row.amount_paid),
                    str(row.balance_due),
                    row.due_date.isoformat(),
                    str(row.days_overdue),
                    row.status.value,
                ]
            )
    return buf.getvalue().encode("utf-8"), "text/csv", f"financial-{rt}-{year}-{month:02d}.csv"


def _compute_days_vacant(bed: Bed, now: datetime) -> int:
    if bed.status != BedStatus.VACANT or bed.vacant_since is None:
        return 0
    return max(0, (now - ensure_utc(bed.vacant_since)).days)


def get_vacancy_dashboard(
    db: Session,
    *,
    pg: PGProperty,
    owner_user: User | None = None,
    room_id: int | None = None,
    status_filter: BedStatus | None = None,
    search: str | None = None,
    public_only: bool = False,
    include_share_links: bool = True,
) -> OwnerVacancyDashboardOut:
    now = datetime.now(timezone.utc)
    rooms = db.scalars(
        select(Room).where(Room.pg_id == pg.id, Room.is_active.is_(True)).order_by(Room.room_number.asc())
    ).all()
    room_map = {r.id: r for r in rooms}

    beds = (
        db.scalars(
            select(Bed)
            .where(Bed.pg_id == pg.id, Bed.room_id.in_(list(room_map.keys())))
            .order_by(Bed.bed_code.asc())
        ).all()
        if room_map
        else []
    )

    active_tenants = db.scalars(
        select(Tenant).where(
            Tenant.pg_id == pg.id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
    ).all()
    occupant_map = {t.bed_id: t for t in active_tenants}

    bed_rows: list[BedVacancyOut] = []
    occupied = vacant = notice = maint = 0
    vacant_potential = Decimal("0.00")
    search_lower = search.strip().lower() if search else None

    for bed in beds:
        room = room_map[bed.room_id]
        if bed.status == BedStatus.OCCUPIED:
            occupied += 1
        elif bed.status == BedStatus.VACANT:
            vacant += 1
            vacant_potential += Decimal(bed.monthly_rent)
        elif bed.status == BedStatus.NOTICE_PERIOD:
            notice += 1
        elif bed.status == BedStatus.MAINTENANCE:
            maint += 1

        if room_id is not None and bed.room_id != room_id:
            continue
        if status_filter is not None and bed.status != status_filter:
            continue
        if public_only and not bed.is_publicly_available:
            continue

        occ_tenant = occupant_map.get(bed.id)
        occ_name = occ_tenant.full_name if occ_tenant else None

        if search_lower:
            hay = f"{room.room_number} {room.floor} {bed.bed_code} {occ_name or ''}".lower()
            if search_lower not in hay:
                continue

        bed_rows.append(
            BedVacancyOut(
                id=bed.id,
                room_id=bed.room_id,
                room_number=room.room_number,
                floor=room.floor,
                sharing_type=room.sharing_type,
                bed_label=bed.bed_label,
                bed_code=bed.bed_code,
                status=bed.status,
                monthly_rent=bed.monthly_rent,
                days_vacant=_compute_days_vacant(bed, now),
                is_publicly_available=bed.is_publicly_available,
                occupant_name=occ_name,
                notice_date=occ_tenant.notice_date if occ_tenant else None,
                expected_leaving_date=occ_tenant.expected_leaving_date if occ_tenant else None,
            )
        )

    links = (
        db.scalars(
            select(VacancyShareLink)
            .where(VacancyShareLink.pg_id == pg.id, VacancyShareLink.is_active.is_(True))
            .order_by(VacancyShareLink.created_at.desc())
        ).all()
        if include_share_links
        else []
    )

    total_beds = len(beds)
    occ_pct = round(((occupied + notice) / total_beds) * 100.0, 1) if total_beds > 0 else 0.0
    owned_pgs = _list_owned_pgs(db, owner_user) if owner_user else [pg]
    if all(p.id != pg.id for p in owned_pgs):
        owned_pgs = [pg, *owned_pgs]

    return OwnerVacancyDashboardOut(
        pg_id=pg.id,
        pg_name=pg.name,
        properties=_build_property_summaries(db, owned_pgs),
        total_rooms=len(rooms),
        total_beds=total_beds,
        occupied_beds=occupied,
        vacant_beds=vacant,
        notice_period_beds=notice,
        maintenance_beds=maint,
        occupancy_percentage=occ_pct,
        vacant_monthly_potential=vacant_potential,
        beds=bed_rows,
        share_links=[
            VacancyShareLinkOut(
                id=l.id,
                token=l.token,
                title=l.title,
                is_active=l.is_active,
                expires_at=l.expires_at,
                created_at=l.created_at,
                share_path=f"/vacancy/{l.token}",
            )
            for l in links
        ],
    )


def update_bed_vacancy_settings(
    db: Session,
    *,
    pg_id: int,
    bed_id: int,
    new_status: BedStatus | None = None,
    is_publicly_available: bool | None = None,
) -> BedVacancyOut:
    bed = db.get(Bed, bed_id)
    if bed is None or bed.pg_id != pg_id:
        raise HTTPException(status_code=404, detail="Bed not found.")

    if is_publicly_available is not None:
        bed.is_publicly_available = is_publicly_available

    now = datetime.now(timezone.utc)
    if new_status is not None and new_status != bed.status:
        if new_status == BedStatus.OCCUPIED:
            raise HTTPException(status_code=400, detail="Register a tenant to occupy a bed.")
        active_tenant = db.scalar(
            select(Tenant).where(
                Tenant.bed_id == bed.id,
                Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
            )
        )
        if active_tenant is not None and new_status in (BedStatus.VACANT, BedStatus.MAINTENANCE):
            raise HTTPException(
                status_code=409,
                detail="Cannot mark an occupied bed vacant/maintenance before tenant checkout.",
            )
        bed.status = new_status
        if new_status == BedStatus.VACANT:
            bed.vacant_since = now
            existing_open = db.scalar(
                select(VacancyRecord).where(
                    VacancyRecord.bed_id == bed.id,
                    VacancyRecord.status == VacancyStatus.OPEN,
                )
            )
            if existing_open is None:
                db.add(
                    VacancyRecord(
                        pg_id=pg_id,
                        bed_id=bed.id,
                        vacant_from=now,
                        monthly_rent_snapshot=bed.monthly_rent,
                        status=VacancyStatus.OPEN,
                    )
                )
        elif new_status == BedStatus.MAINTENANCE:
            bed.vacant_since = None
            open_vacs = db.scalars(
                select(VacancyRecord).where(
                    VacancyRecord.bed_id == bed.id,
                    VacancyRecord.status == VacancyStatus.OPEN,
                )
            ).all()
            for v in open_vacs:
                v.status = VacancyStatus.FILLED
                v.filled_at = now

    db.commit()
    db.refresh(bed)
    room = bed.room
    occ = db.scalar(
        select(Tenant).where(
            Tenant.bed_id == bed.id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
    )
    return BedVacancyOut(
        id=bed.id,
        room_id=bed.room_id,
        room_number=room.room_number if room else "-",
        floor=room.floor if room else "-",
        sharing_type=room.sharing_type if room else SharingType.DOUBLE,
        bed_label=bed.bed_label,
        bed_code=bed.bed_code,
        status=bed.status,
        monthly_rent=bed.monthly_rent,
        days_vacant=_compute_days_vacant(bed, now),
        is_publicly_available=bed.is_publicly_available,
        occupant_name=occ.full_name if occ else None,
        notice_date=occ.notice_date if occ else None,
        expected_leaving_date=occ.expected_leaving_date if occ else None,
    )


def create_share_link(
    db: Session,
    *,
    pg: PGProperty,
    owner: User,
    body: VacancyShareLinkCreateIn,
) -> VacancyShareLinkOut:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    link = VacancyShareLink(
        pg_id=pg.id,
        token=secrets.token_urlsafe(16),
        title=body.title.strip(),
        is_active=True,
        expires_at=expires_at,
        created_by=owner.id,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return VacancyShareLinkOut(
        id=link.id,
        token=link.token,
        title=link.title,
        is_active=link.is_active,
        expires_at=link.expires_at,
        created_at=link.created_at,
        share_path=f"/vacancy/{link.token}",
    )


def revoke_share_link(db: Session, *, pg: PGProperty, link_id: int) -> dict[str, str]:
    link = db.get(VacancyShareLink, link_id)
    if link is None or link.pg_id != pg.id:
        raise HTTPException(status_code=404, detail="Share link not found.")
    link.is_active = False
    db.commit()
    return {"message": "Vacancy share link revoked."}


def _serialize_public_vacancy_for_pg(
    db: Session,
    *,
    pg: PGProperty,
    title: str,
    now: datetime,
) -> PublicVacancyPageOut:
    rooms = db.scalars(select(Room).where(Room.pg_id == pg.id, Room.is_active.is_(True))).all()
    room_map = {r.id: r for r in rooms}
    beds = (
        db.scalars(
            select(Bed)
            .where(
                Bed.pg_id == pg.id,
                Bed.room_id.in_(list(room_map.keys())),
                Bed.is_publicly_available.is_(True),
                Bed.status.in_([BedStatus.VACANT, BedStatus.NOTICE_PERIOD]),
            )
            .order_by(Bed.bed_code.asc())
        ).all()
        if room_map
        else []
    )

    available_beds: list[PublicVacancyBedOut] = []
    vacant_count = 0
    notice_count = 0
    for b in beds:
        room = room_map[b.room_id]
        if b.status == BedStatus.VACANT:
            vacant_count += 1
        elif b.status == BedStatus.NOTICE_PERIOD:
            notice_count += 1
        available_beds.append(
            PublicVacancyBedOut(
                room_number=room.room_number,
                floor=room.floor,
                sharing_type=room.sharing_type,
                bed_code=b.bed_code,
                status=b.status,
                monthly_rent=b.monthly_rent,
                days_vacant=_compute_days_vacant(b, now),
            )
        )

    return PublicVacancyPageOut(
        pg_name=pg.name,
        address=pg.address,
        city=pg.city,
        gender_policy=pg.gender_policy,
        amenities=pg.amenities,
        breakfast_timing=pg.breakfast_timing,
        lunch_timing=pg.lunch_timing,
        dinner_timing=pg.dinner_timing,
        title=title,
        vacant_beds_count=vacant_count,
        notice_period_beds_count=notice_count,
        available_beds=available_beds,
    )


def get_public_vacancy_by_token(db: Session, token: str) -> PublicVacancyPageOut:
    """Public vacancy payload exposing zero tenant personal data and only publicly available beds."""
    link = db.scalar(select(VacancyShareLink).where(VacancyShareLink.token == token))
    if link is None or not link.is_active:
        raise HTTPException(status_code=404, detail="Vacancy link is invalid or inactive.")
    now = datetime.now(timezone.utc)
    if link.expires_at is not None and ensure_utc(link.expires_at) < now:
        raise HTTPException(status_code=410, detail="This vacancy link has expired.")

    pg = db.get(PGProperty, link.pg_id)
    if pg is None:
        raise HTTPException(status_code=404, detail="PG property not found.")

    return _serialize_public_vacancy_for_pg(db, pg=pg, title=link.title, now=now)


def list_public_vacancies_directory(db: Session) -> list[dict]:
    """List PGs that have an active, non-expired public vacancy share link."""
    now = datetime.now(timezone.utc)
    links = db.scalars(
        select(VacancyShareLink)
        .where(VacancyShareLink.is_active.is_(True))
        .order_by(VacancyShareLink.created_at.desc())
    ).all()
    seen_pg_ids: set[int] = set()
    results: list[dict] = []
    for link in links:
        if link.expires_at is not None and ensure_utc(link.expires_at) < now:
            continue
        if link.pg_id in seen_pg_ids:
            continue
        pg = db.get(PGProperty, link.pg_id)
        if pg is None:
            continue
        payload = _serialize_public_vacancy_for_pg(db, pg=pg, title=link.title, now=now)
        seen_pg_ids.add(pg.id)
        results.append(
            {
                "share_token": link.token,
                "share_path": f"/vacancy/{link.token}",
                **payload.model_dump(mode="json"),
            }
        )
    return results


def list_managers(db: Session, *, pg: PGProperty) -> list[ManagerOut]:
    rows = db.scalars(
        select(User).where(User.pg_id == pg.id, User.role == UserRole.MANAGER).order_by(User.id.asc())
    ).all()
    return [
        ManagerOut(
            id=u.id,
            full_name=u.full_name,
            mobile=u.mobile,
            email=u.email,
            is_active=u.is_active,
            created_at=u.created_at,
        )
        for u in rows
    ]


def create_manager(db: Session, *, pg: PGProperty, body: ManagerCreateIn) -> ManagerOut:
    try:
        mobile = normalize_mobile(body.mobile)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    existing = db.scalar(select(User).where(User.mobile == mobile))
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this mobile number already exists.")

    mgr = User(
        pg_id=pg.id,
        full_name=body.full_name.strip(),
        mobile=mobile,
        email=str(body.email) if body.email else None,
        password_hash=hash_password(body.password),
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(mgr)
    db.commit()
    db.refresh(mgr)
    return ManagerOut(
        id=mgr.id,
        full_name=mgr.full_name,
        mobile=mgr.mobile,
        email=mgr.email,
        is_active=mgr.is_active,
        created_at=mgr.created_at,
    )


def update_manager(db: Session, *, pg: PGProperty, manager_id: int, body: ManagerUpdateIn) -> ManagerOut:
    mgr = db.get(User, manager_id)
    if mgr is None or mgr.pg_id != pg.id or mgr.role != UserRole.MANAGER:
        raise HTTPException(status_code=404, detail="Manager not found.")
    if body.full_name is not None:
        mgr.full_name = body.full_name.strip()
    if body.email is not None:
        mgr.email = str(body.email)
    if body.is_active is not None:
        mgr.is_active = body.is_active
    if body.password is not None:
        mgr.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(mgr)
    return ManagerOut(
        id=mgr.id,
        full_name=mgr.full_name,
        mobile=mgr.mobile,
        email=mgr.email,
        is_active=mgr.is_active,
        created_at=mgr.created_at,
    )


def remove_manager(db: Session, *, pg: PGProperty, manager_id: int) -> dict[str, str]:
    mgr = db.get(User, manager_id)
    if mgr is None or mgr.pg_id != pg.id or mgr.role != UserRole.MANAGER:
        raise HTTPException(status_code=404, detail="Manager not found.")
    mgr.is_active = False
    db.commit()
    return {"message": "Manager access removed."}


def update_pg_settings(db: Session, *, pg: PGProperty, body: PGSettingsUpdateIn) -> dict:
    for field in (
        "name",
        "address",
        "city",
        "gender_policy",
        "rent_due_day",
        "default_monthly_rent",
        "default_food_charges",
        "default_security_deposit",
        "breakfast_timing",
        "lunch_timing",
        "dinner_timing",
        "amenities",
    ):
        val = getattr(body, field)
        if val is not None:
            setattr(pg, field, val.strip() if isinstance(val, str) else val)
    db.commit()
    db.refresh(pg)
    return {
        "id": pg.id,
        "name": pg.name,
        "address": pg.address,
        "city": pg.city,
        "gender_policy": pg.gender_policy.value,
        "rent_due_day": pg.rent_due_day,
        "default_monthly_rent": str(pg.default_monthly_rent),
        "default_food_charges": str(pg.default_food_charges),
        "default_security_deposit": str(pg.default_security_deposit),
        "breakfast_timing": pg.breakfast_timing,
        "lunch_timing": pg.lunch_timing,
        "dinner_timing": pg.dinner_timing,
        "amenities": pg.amenities,
    }


def _default_bed_labels(sharing_type: SharingType) -> list[str]:
    counts = {
        SharingType.SINGLE: ["A"],
        SharingType.DOUBLE: ["A", "B"],
        SharingType.TRIPLE: ["A", "B", "C"],
        SharingType.QUAD: ["A", "B", "C", "D"],
        SharingType.SHARED: ["A", "B", "C", "D"],
    }
    return counts[sharing_type]


def create_room_with_beds(db: Session, *, pg: PGProperty, body: RoomCreateIn) -> dict:
    r_num = body.room_number.strip()
    existing = db.scalar(select(Room).where(Room.pg_id == pg.id, Room.room_number == r_num))
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Room {r_num} already exists.")

    room = Room(
        pg_id=pg.id,
        room_number=r_num,
        floor=body.floor.strip(),
        sharing_type=body.sharing_type,
        base_rent=body.base_rent,
        is_active=True,
    )
    db.add(room)
    db.flush()

    now = datetime.now(timezone.utc)
    labels = [lbl.strip().upper() for lbl in body.bed_labels] if body.bed_labels else _default_bed_labels(body.sharing_type)
    created_beds = []
    for lbl in labels:
        bed = Bed(
            pg_id=pg.id,
            room_id=room.id,
            bed_label=lbl,
            bed_code=f"{r_num}-{lbl}",
            status=BedStatus.VACANT,
            monthly_rent=body.base_rent,
            vacant_since=now,
        )
        db.add(bed)
        db.flush()
        db.add(
            VacancyRecord(
                pg_id=pg.id,
                bed_id=bed.id,
                vacant_from=now,
                monthly_rent_snapshot=bed.monthly_rent,
                status=VacancyStatus.OPEN,
            )
        )
        created_beds.append({"id": bed.id, "bed_code": bed.bed_code, "status": bed.status.value})

    db.commit()
    return {
        "id": room.id,
        "room_number": room.room_number,
        "floor": room.floor,
        "sharing_type": room.sharing_type.value,
        "base_rent": str(room.base_rent),
        "beds": created_beds,
    }


def update_room(db: Session, *, pg: PGProperty, room_id: int, body: RoomUpdateIn) -> dict:
    room = db.get(Room, room_id)
    if room is None or room.pg_id != pg.id:
        raise HTTPException(status_code=404, detail="Room not found.")
    if body.floor is not None:
        room.floor = body.floor.strip()
    if body.sharing_type is not None:
        room.sharing_type = body.sharing_type
    if body.base_rent is not None:
        room.base_rent = body.base_rent
        for bed in room.beds:
            if bed.status == BedStatus.VACANT:
                bed.monthly_rent = body.base_rent
    if body.is_active is not None:
        room.is_active = body.is_active
    db.commit()
    db.refresh(room)
    return {
        "id": room.id,
        "room_number": room.room_number,
        "floor": room.floor,
        "sharing_type": room.sharing_type.value,
        "base_rent": str(room.base_rent),
        "is_active": room.is_active,
    }
