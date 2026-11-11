import calendar
import hashlib
import hmac
import urllib.parse
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.enums import (
    DepositStatus,
    NotificationType,
    PaymentMethod,
    PaymentStatus,
    RentStatus,
    TenantStatus,
)
from app.models.finance import (
    Payment,
    RentRecord,
    SecurityDeposit,
    SecurityDepositTransaction,
)
from app.models.notification import Notification
from app.models.property import Bed, PGProperty, Room
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    CreatePaymentOrderIn,
    CreatePaymentOrderOut,
    DepositTransactionCreateIn,
    FailPaymentIn,
    GenerateRentOut,
    OfflinePaymentIn,
    PaymentOut,
    ReceiptDetailOut,
    RentRecordOut,
    RentRecordUpdateIn,
    SecurityDepositOut,
    SecurityDepositTransactionOut,
    TenantRentSummaryOut,
    VerifyPaymentIn,
)
from app.services.receipt_pdf import build_simple_pdf


def _safe_due_date(year: int, month: int, due_day: int) -> date:
    max_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(max(1, due_day), max_day))


def sync_rent_record_status(record: RentRecord, *, today: date | None = None) -> None:
    """Keep RentRecord status consistent with amount_paid, total_amount, and due_date."""
    ref_day = today or date.today()
    if record.amount_paid >= record.total_amount:
        record.status = RentStatus.PAID
    elif record.amount_paid > Decimal("0.00"):
        record.status = RentStatus.OVERDUE if ref_day > record.due_date else RentStatus.PARTIAL
    else:
        record.status = RentStatus.OVERDUE if ref_day > record.due_date else RentStatus.PENDING


def compute_eligible_period_amounts(
    tenant: Tenant,
    *,
    year: int,
    month: int,
) -> tuple[Decimal, Decimal] | None:
    """Compute prorated (base_rent, food_charges) if tenant is eligible for billing month, else None."""
    days_in_month = calendar.monthrange(year, month)[1]
    period_start = date(year, month, 1)
    period_end = date(year, month, days_in_month)

    active_start = max(period_start, tenant.joining_date)
    active_end = min(period_end, tenant.leaving_date) if tenant.leaving_date else period_end
    if active_start > active_end:
        return None

    active_days = (active_end - active_start).days + 1
    if active_days >= days_in_month:
        return Decimal(tenant.monthly_rent), Decimal(tenant.food_charges)

    ratio = Decimal(active_days) / Decimal(days_in_month)
    prorated_rent = (Decimal(tenant.monthly_rent) * ratio).quantize(Decimal("0.01"))
    prorated_food = (Decimal(tenant.food_charges) * ratio).quantize(Decimal("0.01"))
    return prorated_rent, prorated_food


def ensure_rent_record_for_period(
    db: Session,
    *,
    tenant: Tenant,
    pg: PGProperty,
    year: int,
    month: int,
) -> RentRecord | None:
    """Get or create a monthly RentRecord if tenant is eligible; never overwrites historical amounts."""
    existing = db.scalar(
        select(RentRecord).where(
            RentRecord.tenant_id == tenant.id,
            RentRecord.billing_year == year,
            RentRecord.billing_month == month,
        )
    )
    if existing is not None:
        sync_rent_record_status(existing)
        return existing

    eligible_amounts = compute_eligible_period_amounts(tenant, year=year, month=month)
    if eligible_amounts is None:
        return None

    base_rent, food_charges = eligible_amounts
    total = base_rent + food_charges
    due = _safe_due_date(year, month, pg.rent_due_day)
    initial_status = RentStatus.OVERDUE if date.today() > due and total > 0 else RentStatus.PENDING
    if total == Decimal("0.00"):
        initial_status = RentStatus.PAID

    room = db.get(Room, tenant.room_id)
    bed = db.get(Bed, tenant.bed_id)

    record = RentRecord(
        tenant_id=tenant.id,
        pg_id=pg.id,
        billing_month=month,
        billing_year=year,
        room_number_snapshot=room.room_number if room else "-",
        bed_code_snapshot=bed.bed_code if bed else "-",
        base_rent=base_rent,
        food_charges=food_charges,
        other_charges=Decimal("0.00"),
        total_amount=total,
        amount_paid=Decimal("0.00"),
        due_date=due,
        status=initial_status,
    )
    db.add(record)
    db.flush()
    return record


def to_rent_record_out(db: Session, record: RentRecord) -> RentRecordOut:
    tenant = db.get(Tenant, record.tenant_id)
    room_num = record.room_number_snapshot
    bed_code = record.bed_code_snapshot
    if not room_num and tenant:
        room = db.get(Room, tenant.room_id)
        room_num = room.room_number if room else "-"
    if not bed_code and tenant:
        bed = db.get(Bed, tenant.bed_id)
        bed_code = bed.bed_code if bed else "-"

    balance = max(Decimal("0.00"), Decimal(record.total_amount) - Decimal(record.amount_paid))
    return RentRecordOut(
        id=record.id,
        tenant_id=record.tenant_id,
        pg_id=record.pg_id,
        tenant_name=tenant.full_name if tenant else "Tenant",
        tenant_mobile=tenant.mobile if tenant else "",
        room_number=room_num or "-",
        bed_code=bed_code or "-",
        billing_month=record.billing_month,
        billing_year=record.billing_year,
        base_rent=record.base_rent,
        food_charges=record.food_charges,
        other_charges=record.other_charges,
        other_charges_note=record.other_charges_note,
        total_amount=record.total_amount,
        amount_paid=record.amount_paid,
        balance_due=balance,
        due_date=record.due_date,
        status=record.status,
        reminder_sent_at=record.reminder_sent_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def to_payment_out(db: Session, payment: Payment) -> PaymentOut:
    tenant = db.get(Tenant, payment.tenant_id)
    record = db.get(RentRecord, payment.rent_record_id)
    room_num = record.room_number_snapshot if record else None
    bed_code = record.bed_code_snapshot if record else None
    if not room_num and tenant:
        r = db.get(Room, tenant.room_id)
        room_num = r.room_number if r else "-"
    if not bed_code and tenant:
        b = db.get(Bed, tenant.bed_id)
        bed_code = b.bed_code if b else "-"

    return PaymentOut(
        id=payment.id,
        rent_record_id=payment.rent_record_id,
        tenant_id=payment.tenant_id,
        tenant_name=tenant.full_name if tenant else "Tenant",
        room_number=room_num or "-",
        bed_code=bed_code or "-",
        billing_month=record.billing_month if record else None,
        billing_year=record.billing_year if record else None,
        amount=payment.amount,
        payment_method=payment.payment_method,
        gateway_provider=payment.gateway_provider,
        gateway_order_id=payment.gateway_order_id,
        gateway_payment_id=payment.gateway_payment_id,
        status=payment.status,
        receipt_number=payment.receipt_number,
        paid_at=payment.paid_at,
        notes=payment.notes,
        created_at=payment.created_at,
    )


def serialize_deposit(db: Session, deposit: SecurityDeposit) -> SecurityDepositOut:
    tenant = db.get(Tenant, deposit.tenant_id)
    room = db.get(Room, tenant.room_id) if tenant else None
    bed = db.get(Bed, tenant.bed_id) if tenant else None
    refundable = max(
        Decimal("0.00"),
        Decimal(deposit.amount_held) - Decimal(deposit.deduction_amount) - Decimal(deposit.refund_amount),
    )
    txs = db.scalars(
        select(SecurityDepositTransaction)
        .where(SecurityDepositTransaction.security_deposit_id == deposit.id)
        .order_by(SecurityDepositTransaction.created_at.desc(), SecurityDepositTransaction.id.desc())
    ).all()
    return SecurityDepositOut(
        id=deposit.id,
        tenant_id=deposit.tenant_id,
        tenant_name=tenant.full_name if tenant else "Tenant",
        tenant_mobile=tenant.mobile if tenant else "",
        room_number=room.room_number if room else "-",
        bed_code=bed.bed_code if bed else "-",
        tenant_status=tenant.status.value if tenant else "",
        amount_held=deposit.amount_held,
        paid_status=deposit.paid_status,
        deduction_amount=deposit.deduction_amount,
        deduction_reason=deposit.deduction_reason,
        refund_amount=deposit.refund_amount,
        refundable_balance=refundable,
        refund_date=deposit.refund_date,
        transactions=[
            SecurityDepositTransactionOut(
                id=tx.id,
                transaction_type=tx.transaction_type,
                amount=tx.amount,
                payment_method=tx.payment_method,
                reference_id=tx.reference_id,
                reason=tx.reason,
                transaction_date=tx.transaction_date,
                created_at=tx.created_at,
            )
            for tx in txs
        ],
    )


def get_tenant_rent_summary(db: Session, tenant: Tenant) -> TenantRentSummaryOut:
    settings = get_settings()
    pg = db.get(PGProperty, tenant.pg_id)
    room = db.get(Room, tenant.room_id)
    bed = db.get(Bed, tenant.bed_id)
    if pg is None or room is None or bed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PG allocation details missing.")

    today = date.today()
    if tenant.status in (TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD):
        ensure_rent_record_for_period(db, tenant=tenant, pg=pg, year=today.year, month=today.month)
        db.commit()

    all_records = db.scalars(
        select(RentRecord)
        .where(RentRecord.tenant_id == tenant.id)
        .order_by(RentRecord.billing_year.desc(), RentRecord.billing_month.desc())
    ).all()
    for r in all_records:
        sync_rent_record_status(r, today=today)
    db.commit()

    current_record = next(
        (r for r in all_records if r.billing_year == today.year and r.billing_month == today.month),
        all_records[0] if all_records else None,
    )

    deposit = db.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant.id))
    deposit_out = (
        serialize_deposit(db, deposit)
        if deposit
        else SecurityDepositOut(
            tenant_id=tenant.id,
            tenant_name=tenant.full_name,
            amount_held=tenant.security_deposit_amount,
            paid_status=DepositStatus.HELD if tenant.security_deposit_amount > 0 else DepositStatus.PENDING,
            deduction_amount=Decimal("0.00"),
            deduction_reason=None,
            refund_amount=Decimal("0.00"),
            refundable_balance=tenant.security_deposit_amount,
            refund_date=None,
            transactions=[],
        )
    )

    payments = db.scalars(
        select(Payment)
        .where(Payment.tenant_id == tenant.id)
        .order_by(Payment.created_at.desc(), Payment.id.desc())
    ).all()

    return TenantRentSummaryOut(
        tenant_id=tenant.id,
        tenant_name=tenant.full_name,
        pg_name=pg.name,
        room_number=room.room_number,
        bed_code=bed.bed_code,
        current_rent=to_rent_record_out(db, current_record) if current_record else None,
        previous_bills=[to_rent_record_out(db, r) for r in all_records],
        security_deposit=deposit_out,
        payment_history=[to_payment_out(db, p) for p in payments],
        razorpay_enabled=settings.razorpay_configured,
        razorpay_key_id=settings.RAZORPAY_KEY_ID if settings.razorpay_configured else None,
    )


def generate_monthly_rent_records(
    db: Session,
    *,
    pg_id: int,
    billing_month: int,
    billing_year: int,
) -> GenerateRentOut:
    """Generate monthly rent records idempotently for all eligible tenants in the PG."""
    pg = db.get(PGProperty, pg_id)
    if pg is None:
        raise HTTPException(status_code=404, detail="PG property not found.")

    tenants = db.scalars(
        select(Tenant).where(Tenant.pg_id == pg_id).order_by(Tenant.id.asc())
    ).all()

    created = 0
    skipped = 0
    ineligible = 0
    result_records: list[RentRecord] = []

    for tenant in tenants:
        existing = db.scalar(
            select(RentRecord).where(
                RentRecord.tenant_id == tenant.id,
                RentRecord.billing_year == billing_year,
                RentRecord.billing_month == billing_month,
            )
        )
        if existing is not None:
            sync_rent_record_status(existing)
            skipped += 1
            result_records.append(existing)
            continue

        rec = ensure_rent_record_for_period(
            db,
            tenant=tenant,
            pg=pg,
            year=billing_year,
            month=billing_month,
        )
        if rec is None:
            ineligible += 1
        else:
            created += 1
            result_records.append(rec)

    db.commit()
    return GenerateRentOut(
        billing_month=billing_month,
        billing_year=billing_year,
        created_count=created,
        skipped_existing_count=skipped,
        ineligible_count=ineligible,
        records=[to_rent_record_out(db, r) for r in result_records],
    )


def list_pg_rent_records(
    db: Session,
    *,
    pg_id: int,
    month: int | None = None,
    year: int | None = None,
    status_filter: RentStatus | None = None,
    search: str | None = None,
    outstanding_only: bool = False,
) -> list[RentRecordOut]:
    query = (
        select(RentRecord)
        .where(RentRecord.pg_id == pg_id)
        .order_by(RentRecord.billing_year.desc(), RentRecord.billing_month.desc(), RentRecord.id.desc())
    )
    if month is not None:
        query = query.where(RentRecord.billing_month == month)
    if year is not None:
        query = query.where(RentRecord.billing_year == year)

    rows = db.scalars(query).all()
    today = date.today()
    out: list[RentRecordOut] = []
    search_q = search.strip().lower() if search else None

    for rec in rows:
        sync_rent_record_status(rec, today=today)
        if outstanding_only and rec.status == RentStatus.PAID:
            continue
        if status_filter is not None and rec.status != status_filter:
            continue
        dto = to_rent_record_out(db, rec)
        if search_q:
            hay = f"{dto.tenant_name} {dto.tenant_mobile} {dto.room_number} {dto.bed_code}".lower()
            if search_q not in hay:
                continue
        out.append(dto)

    db.commit()
    return out


def update_rent_record_charges(
    db: Session,
    *,
    pg_id: int,
    rent_record_id: int,
    body: RentRecordUpdateIn,
) -> RentRecordOut:
    rec = db.get(RentRecord, rent_record_id)
    if rec is None or rec.pg_id != pg_id:
        raise HTTPException(status_code=404, detail="Rent record not found.")

    if body.other_charges is not None:
        new_total = Decimal(rec.base_rent) + Decimal(rec.food_charges) + Decimal(body.other_charges)
        if new_total < Decimal(rec.amount_paid):
            raise HTTPException(
                status_code=422,
                detail="Updated total cannot be less than amount already paid.",
            )
        rec.other_charges = body.other_charges
        rec.total_amount = new_total
    if body.other_charges_note is not None:
        rec.other_charges_note = body.other_charges_note.strip() or None
    if body.due_date is not None:
        rec.due_date = body.due_date

    sync_rent_record_status(rec)
    db.commit()
    db.refresh(rec)
    return to_rent_record_out(db, rec)


def _compute_hmac_signature(secret: str, order_id: str, payment_id: str) -> str:
    msg = f"{order_id}|{payment_id}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def create_payment_order(
    db: Session,
    *,
    tenant: Tenant,
    body: CreatePaymentOrderIn,
) -> CreatePaymentOrderOut:
    """Create a Razorpay payment order; refuses simulated online payments when credentials are absent."""
    if body.payment_method not in (PaymentMethod.UPI, PaymentMethod.CARD, PaymentMethod.NET_BANKING):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Online checkout supports upi, card, or net_banking.",
        )

    settings = get_settings()
    if not settings.razorpay_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Razorpay gateway credentials are not configured. "
                "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend .env or use offline payment recording."
            ),
        )

    record = db.get(RentRecord, body.rent_record_id)
    if record is None or record.tenant_id != tenant.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rent record not found.")

    balance = max(Decimal("0.00"), Decimal(record.total_amount) - Decimal(record.amount_paid))
    if balance <= Decimal("0.00"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This rent bill is already fully paid.")

    charge_amount = Decimal(body.amount) if body.amount is not None else balance
    if charge_amount <= Decimal("0.00") or charge_amount > balance:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Payment amount ({charge_amount}) must be between 0.01 and remaining balance ({balance}).",
        )

    amount_paise = int((charge_amount * 100).quantize(Decimal("1")))
    try:
        resp = httpx.post(
            "https://api.razorpay.com/v1/orders",
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
            json={
                "amount": amount_paise,
                "currency": "INR",
                "receipt": f"rent_{record.id}_{uuid.uuid4().hex[:8]}",
                "notes": {
                    "tenant_id": str(tenant.id),
                    "rent_record_id": str(record.id),
                },
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        order_id = resp.json()["id"]
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to create Razorpay order. Verify gateway credentials.",
        ) from exc

    payment = Payment(
        rent_record_id=record.id,
        tenant_id=tenant.id,
        pg_id=tenant.pg_id,
        amount=charge_amount,
        payment_method=body.payment_method,
        gateway_provider="razorpay",
        gateway_order_id=order_id,
        status=PaymentStatus.CREATED,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    return CreatePaymentOrderOut(
        payment_id=payment.id,
        gateway_provider="razorpay",
        gateway_order_id=order_id,
        amount_paise=amount_paise,
        amount_rupees=charge_amount,
        razorpay_key_id=settings.RAZORPAY_KEY_ID,
    )


def verify_payment(
    db: Session,
    *,
    tenant: Tenant,
    body: VerifyPaymentIn,
) -> PaymentOut:
    """Verify Razorpay HMAC-SHA256 signature and prevent duplicate transaction processing."""
    payment = db.get(Payment, body.payment_id)
    if payment is None or payment.tenant_id != tenant.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment order not found.")
    if payment.status == PaymentStatus.VERIFIED_PAID:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This payment order has already been verified and settled.",
        )
    if payment.gateway_order_id != body.gateway_order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gateway order ID mismatch.")

    gw_payment_id = body.gateway_payment_id.strip()
    gw_signature = body.gateway_signature.strip()
    if not gw_payment_id or not gw_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing verified payment confirmation details.",
        )

    dup_tx = db.scalar(
        select(Payment).where(
            Payment.gateway_payment_id == gw_payment_id,
            Payment.id != payment.id,
        )
    )
    if dup_tx is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Duplicate gateway transaction reference detected.",
        )

    settings = get_settings()
    if payment.gateway_provider != "razorpay" or not settings.razorpay_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Razorpay verification is not configured on this server.",
        )

    expected = _compute_hmac_signature(
        settings.RAZORPAY_KEY_SECRET,
        body.gateway_order_id,
        gw_payment_id,
    )
    if not hmac.compare_digest(expected, gw_signature):
        payment.status = PaymentStatus.FAILED
        payment.notes = "Gateway signature verification failed."
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment signature verification failed. Transaction was not marked paid.",
        )

    record = db.get(RentRecord, payment.rent_record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Associated rent record not found.")

    remaining = max(Decimal("0.00"), Decimal(record.total_amount) - Decimal(record.amount_paid))
    if Decimal(payment.amount) > remaining:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rent balance has changed and payment exceeds remaining due.",
        )

    now = datetime.now(timezone.utc)
    payment.gateway_payment_id = gw_payment_id
    payment.gateway_signature = gw_signature
    payment.status = PaymentStatus.VERIFIED_PAID
    payment.paid_at = now
    payment.receipt_number = f"RCPT-{record.billing_year}{record.billing_month:02d}-{payment.id:05d}"

    record.amount_paid = Decimal(record.amount_paid) + Decimal(payment.amount)
    sync_rent_record_status(record)

    db.add(
        Notification(
            user_id=tenant.user_id,
            pg_id=tenant.pg_id,
            notif_type=NotificationType.PAYMENT_RECEIPT,
            title=f"Rent Receipt {payment.receipt_number}",
            message=(
                f"Payment of INR {payment.amount} verified for "
                f"{calendar.month_name[record.billing_month]} {record.billing_year}."
            ),
        )
    )
    db.commit()
    db.refresh(payment)
    return to_payment_out(db, payment)


def mark_gateway_payment_failed(
    db: Session,
    *,
    tenant: Tenant,
    body: FailPaymentIn,
) -> PaymentOut:
    """Record a failed or cancelled gateway payment without altering rent balance."""
    payment = db.get(Payment, body.payment_id)
    if payment is None or payment.tenant_id != tenant.id:
        raise HTTPException(status_code=404, detail="Payment order not found.")
    if payment.status == PaymentStatus.VERIFIED_PAID:
        raise HTTPException(status_code=409, detail="Cannot fail an already verified payment.")
    if payment.gateway_order_id != body.gateway_order_id:
        raise HTTPException(status_code=400, detail="Gateway order ID mismatch.")

    payment.status = PaymentStatus.FAILED
    payment.notes = body.reason.strip() if body.reason else "Gateway checkout failed or cancelled."
    db.commit()
    db.refresh(payment)
    return to_payment_out(db, payment)


def record_offline_payment(
    db: Session,
    *,
    pg_id: int,
    actor: User,
    body: OfflinePaymentIn,
) -> PaymentOut:
    """Allow authorized Owner or Manager to record verified Cash / Bank Transfer / UPI rent payments."""
    record = db.get(RentRecord, body.rent_record_id)
    if record is None or record.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rent record not found.")

    balance = max(Decimal("0.00"), Decimal(record.total_amount) - Decimal(record.amount_paid))
    if balance <= Decimal("0.00"):
        raise HTTPException(status_code=400, detail="This rent record is already fully paid.")
    if body.amount > balance:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Payment amount ({body.amount}) exceeds remaining balance ({balance}).",
        )

    tx_ref = body.transaction_ref.strip() if body.transaction_ref and body.transaction_ref.strip() else None
    if tx_ref:
        dup = db.scalar(select(Payment).where(Payment.gateway_payment_id == tx_ref))
        if dup is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Duplicate transaction reference '{tx_ref}'.",
            )

    now = datetime.now(timezone.utc)
    paid_dt = (
        datetime.combine(body.payment_date, now.timetz())
        if body.payment_date
        else now
    )
    payment = Payment(
        rent_record_id=record.id,
        tenant_id=record.tenant_id,
        pg_id=pg_id,
        amount=body.amount,
        payment_method=body.payment_method,
        gateway_provider="offline_verified",
        gateway_order_id=f"offline_{uuid.uuid4().hex[:14]}",
        gateway_payment_id=tx_ref or f"off_{uuid.uuid4().hex[:12]}",
        status=PaymentStatus.VERIFIED_PAID,
        paid_at=paid_dt,
        recorded_by=actor.id,
        notes=body.notes.strip() if body.notes else None,
    )
    db.add(payment)
    db.flush()
    payment.receipt_number = f"RCPT-{record.billing_year}{record.billing_month:02d}-{payment.id:05d}"

    record.amount_paid = Decimal(record.amount_paid) + Decimal(body.amount)
    sync_rent_record_status(record)

    tenant = db.get(Tenant, record.tenant_id)
    if tenant is not None:
        db.add(
            Notification(
                user_id=tenant.user_id,
                pg_id=pg_id,
                notif_type=NotificationType.PAYMENT_RECEIPT,
                title=f"Rent Receipt {payment.receipt_number}",
                message=(
                    f"Offline payment of INR {payment.amount} ({body.payment_method.value}) "
                    f"recorded for {calendar.month_name[record.billing_month]} {record.billing_year}."
                ),
            )
        )

    db.commit()
    db.refresh(payment)
    return to_payment_out(db, payment)


def get_receipt_detail(
    db: Session,
    *,
    payment_id: int,
    tenant_id_filter: int | None = None,
    pg_id_filter: int | None = None,
) -> ReceiptDetailOut:
    payment = db.get(Payment, payment_id)
    if payment is None or payment.status != PaymentStatus.VERIFIED_PAID:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verified receipt not found.")
    if tenant_id_filter is not None and payment.tenant_id != tenant_id_filter:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this receipt.")
    if pg_id_filter is not None and payment.pg_id != pg_id_filter:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this receipt.")

    record = db.get(RentRecord, payment.rent_record_id)
    tenant = db.get(Tenant, payment.tenant_id)
    pg = db.get(PGProperty, payment.pg_id)
    room = db.get(Room, tenant.room_id) if tenant else None
    bed = db.get(Bed, tenant.bed_id) if tenant else None
    if not (record and tenant and pg):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt metadata incomplete.")

    room_num = record.room_number_snapshot or (room.room_number if room else "-")
    bed_code = record.bed_code_snapshot or (bed.bed_code if bed else "-")
    remaining = max(Decimal("0.00"), Decimal(record.total_amount) - Decimal(record.amount_paid))

    period = f"{calendar.month_name[record.billing_month]} {record.billing_year}"
    receipt_no = payment.receipt_number or f"RCPT-{payment.id}"
    paid_dt = payment.paid_at or payment.created_at
    wa_text = (
        f"*{pg.name} - Rent Receipt*\n"
        f"Receipt No: {receipt_no}\n"
        f"Tenant: {tenant.full_name} (Room {room_num}, Bed {bed_code})\n"
        f"Period: {period}\n"
        f"Amount Paid: Rs. {payment.amount} via {payment.payment_method.value.upper()}\n"
        f"Remaining Balance: Rs. {remaining}\n"
        f"Date: {paid_dt.strftime('%d %b %Y')}"
    )
    wa_url = f"https://wa.me/?text={urllib.parse.quote(wa_text)}"

    return ReceiptDetailOut(
        receipt_number=receipt_no,
        pg_name=pg.name,
        pg_address=f"{pg.address}, {pg.city}".strip(", "),
        tenant_name=tenant.full_name,
        tenant_mobile=tenant.mobile,
        room_number=room_num,
        bed_code=bed_code,
        billing_period=period,
        base_rent=record.base_rent,
        food_charges=record.food_charges,
        other_charges=record.other_charges,
        amount_paid=payment.amount,
        remaining_balance=remaining,
        payment_status=record.status.value,
        payment_method=payment.payment_method.value,
        gateway_payment_id=payment.gateway_payment_id,
        paid_at=paid_dt,
        whatsapp_share_text=wa_text,
        whatsapp_share_url=wa_url,
    )


def build_receipt_pdf(detail: ReceiptDetailOut) -> bytes:
    lines = [
        f"Property: {detail.pg_name}",
        f"Address: {detail.pg_address}",
        "------------------------------------------------------------------",
        f"Receipt Number    : {detail.receipt_number}",
        f"Payment Date      : {detail.paid_at.strftime('%d %b %Y %I:%M %p UTC')}",
        f"Tenant Name       : {detail.tenant_name}",
        f"Mobile            : {detail.tenant_mobile}",
        f"Room / Bed        : Room {detail.room_number} | Bed {detail.bed_code}",
        f"Billing Month     : {detail.billing_period}",
        "------------------------------------------------------------------",
        f"Monthly Room Rent : INR {detail.base_rent}",
        f"Food Charges      : INR {detail.food_charges}",
        f"Other Charges     : INR {detail.other_charges}",
        f"Amount Paid       : INR {detail.amount_paid}",
        f"Remaining Balance : INR {detail.remaining_balance}",
        f"Payment Method    : {detail.payment_method.upper()}",
        f"Transaction Ref   : {detail.gateway_payment_id or 'Verified Record'}",
        f"Rent Bill Status  : {detail.payment_status.upper()}",
        "------------------------------------------------------------------",
        "Receipt Status: VERIFIED & PAID",
    ]
    return build_simple_pdf(f"Rent Payment Receipt - {detail.receipt_number}", lines)


def record_deposit_transaction(
    db: Session,
    *,
    pg_id: int,
    tenant_id: int,
    actor: User,
    body: DepositTransactionCreateIn,
) -> SecurityDepositOut:
    """Record security deposit payments, deductions, or refunds without exceeding refundable balance."""
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or tenant.pg_id != pg_id:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    deposit = db.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant.id))
    if deposit is None:
        deposit = SecurityDeposit(
            tenant_id=tenant.id,
            pg_id=pg_id,
            amount_held=Decimal("0.00"),
            paid_status=DepositStatus.PENDING,
        )
        db.add(deposit)
        db.flush()

    tx_date = body.transaction_date or date.today()
    refundable = max(
        Decimal("0.00"),
        Decimal(deposit.amount_held) - Decimal(deposit.deduction_amount) - Decimal(deposit.refund_amount),
    )

    if body.transaction_type == "deposit_received":
        deposit.amount_held = Decimal(deposit.amount_held) + Decimal(body.amount)
        if deposit.paid_status == DepositStatus.PENDING:
            deposit.paid_status = DepositStatus.HELD
    elif body.transaction_type == "deduction":
        if body.amount > refundable:
            raise HTTPException(
                status_code=422,
                detail=f"Deduction ({body.amount}) cannot exceed available deposit balance ({refundable}).",
            )
        deposit.deduction_amount = Decimal(deposit.deduction_amount) + Decimal(body.amount)
        if body.reason:
            deposit.deduction_reason = (
                f"{deposit.deduction_reason}; {body.reason.strip()}".strip("; ")
                if deposit.deduction_reason
                else body.reason.strip()
            )
    elif body.transaction_type == "refund":
        if body.amount > refundable:
            raise HTTPException(
                status_code=422,
                detail=f"Refund amount ({body.amount}) exceeds available refundable balance ({refundable}).",
            )
        deposit.refund_amount = Decimal(deposit.refund_amount) + Decimal(body.amount)
        deposit.refund_date = tx_date

    new_refundable = max(
        Decimal("0.00"),
        Decimal(deposit.amount_held) - Decimal(deposit.deduction_amount) - Decimal(deposit.refund_amount),
    )
    if deposit.refund_amount > Decimal("0.00"):
        if new_refundable == Decimal("0.00") and deposit.deduction_amount == Decimal("0.00"):
            deposit.paid_status = DepositStatus.REFUNDED
        else:
            deposit.paid_status = DepositStatus.PARTIALLY_REFUNDED
    elif deposit.amount_held > Decimal("0.00"):
        deposit.paid_status = DepositStatus.HELD

    db.add(
        SecurityDepositTransaction(
            security_deposit_id=deposit.id,
            tenant_id=tenant.id,
            pg_id=pg_id,
            transaction_type=body.transaction_type,
            amount=body.amount,
            payment_method=body.payment_method,
            reference_id=body.reference_id,
            reason=body.reason.strip() if body.reason else None,
            transaction_date=tx_date,
            recorded_by=actor.id,
        )
    )
    db.commit()
    db.refresh(deposit)
    return serialize_deposit(db, deposit)
