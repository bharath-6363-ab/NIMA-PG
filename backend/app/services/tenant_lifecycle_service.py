import secrets
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.security import hash_password, normalize_mobile
from app.models.enums import (
    BedStatus,
    DepositStatus,
    DocumentType,
    GenderPolicy,
    TenantStatus,
    UserRole,
    VacancyStatus,
)
from app.models.finance import SecurityDeposit, SecurityDepositTransaction
from app.models.property import Bed, PGProperty, Room, VacancyRecord
from app.models.tenant import Tenant, TenantAllocationHistory, TenantDocument
from app.models.user import User
from app.schemas.domain import (
    TenantAllocationHistoryOut,
    TenantCheckoutIn,
    TenantCheckoutOut,
    TenantCreateIn,
    TenantCreateOut,
    TenantDocumentOut,
    TenantSummaryOut,
    TenantUpdateIn,
)
from app.services.payment_service import ensure_rent_record_for_period
from app.services.storage_service import ALLOWED_DOC_EXTENSIONS, save_upload_file


def _serialize_history_row(db: Session, row: TenantAllocationHistory) -> TenantAllocationHistoryOut:
    room = db.get(Room, row.room_id)
    bed = db.get(Bed, row.bed_id)
    return TenantAllocationHistoryOut(
        id=row.id,
        room_id=row.room_id,
        room_number=room.room_number if room else "-",
        bed_id=row.bed_id,
        bed_code=bed.bed_code if bed else "-",
        action=row.action,
        start_date=row.start_date,
        end_date=row.end_date,
        monthly_rent=row.monthly_rent,
        food_charges=row.food_charges,
        remarks=row.remarks,
        created_at=row.created_at,
    )


def serialize_tenant(db: Session, tenant: Tenant) -> TenantSummaryOut:
    room = db.get(Room, tenant.room_id)
    bed = db.get(Bed, tenant.bed_id)
    deposit = db.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant.id))
    history_rows = db.scalars(
        select(TenantAllocationHistory)
        .where(TenantAllocationHistory.tenant_id == tenant.id)
        .order_by(TenantAllocationHistory.created_at.desc(), TenantAllocationHistory.id.desc())
    ).all()

    return TenantSummaryOut(
        id=tenant.id,
        user_id=tenant.user_id,
        full_name=tenant.full_name,
        mobile=tenant.mobile,
        email=tenant.email,
        gender=tenant.gender,
        date_of_birth=tenant.date_of_birth,
        permanent_address=tenant.permanent_address,
        room_id=tenant.room_id,
        room_number=room.room_number if room else "-",
        bed_id=tenant.bed_id,
        bed_code=bed.bed_code if bed else "-",
        monthly_rent=tenant.monthly_rent,
        food_charges=tenant.food_charges,
        security_deposit_amount=tenant.security_deposit_amount,
        joining_date=tenant.joining_date,
        expected_leaving_date=tenant.expected_leaving_date,
        notice_date=tenant.notice_date,
        leaving_date=tenant.leaving_date,
        emergency_contact_name=tenant.emergency_contact_name,
        emergency_contact_phone=tenant.emergency_contact_phone,
        police_verification_status=tenant.police_verification_status,
        status=tenant.status,
        notes=tenant.notes,
        checkout_remarks=tenant.checkout_remarks,
        deposit_status=deposit.paid_status if deposit else None,
        deposit_deduction_amount=deposit.deduction_amount if deposit else None,
        deposit_deduction_reason=deposit.deduction_reason if deposit else None,
        deposit_refund_amount=deposit.refund_amount if deposit else None,
        documents=[
            TenantDocumentOut(
                id=doc.id,
                doc_type=doc.doc_type,
                file_name=doc.file_name,
                mime_type=doc.mime_type,
                uploaded_at=doc.uploaded_at,
                url=f"/api/files/tenant-docs/{doc.id}",
            )
            for doc in tenant.documents
        ],
        allocation_history=[_serialize_history_row(db, h) for h in history_rows],
    )


def list_pg_rooms_with_beds(db: Session, *, pg_id: int) -> list[dict]:
    rooms = db.scalars(
        select(Room).where(Room.pg_id == pg_id, Room.is_active.is_(True)).order_by(Room.room_number.asc())
    ).all()
    active_tenants = db.scalars(
        select(Tenant).where(
            Tenant.pg_id == pg_id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
    ).all()
    tenant_by_bed = {t.bed_id: t for t in active_tenants}

    result = []
    for room in rooms:
        beds_sorted = sorted(room.beds, key=lambda b: b.bed_label)
        result.append(
            {
                "id": room.id,
                "room_number": room.room_number,
                "floor": room.floor,
                "sharing_type": room.sharing_type.value,
                "max_capacity": room.max_capacity,
                "description": room.description,
                "base_rent": str(room.base_rent),
                "beds": [
                    {
                        "id": bed.id,
                        "bed_label": bed.bed_label,
                        "bed_code": bed.bed_code,
                        "status": bed.status.value,
                        "monthly_rent": str(bed.monthly_rent),
                        "food_charges": str(bed.food_charges),
                        "tenant_id": tenant_by_bed[bed.id].id if bed.id in tenant_by_bed else None,
                        "tenant_name": tenant_by_bed[bed.id].full_name if bed.id in tenant_by_bed else None,
                    }
                    for bed in beds_sorted
                ],
            }
        )
    return result


def list_tenants(
    db: Session,
    *,
    pg_id: int,
    status_filter: TenantStatus | None = None,
    room_number: str | None = None,
    search: str | None = None,
) -> list[TenantSummaryOut]:
    query = select(Tenant).where(Tenant.pg_id == pg_id).order_by(Tenant.created_at.desc(), Tenant.id.desc())
    if status_filter is not None:
        query = query.where(Tenant.status == status_filter)
    tenants = db.scalars(query).all()
    serialized = [serialize_tenant(db, t) for t in tenants]

    if room_number and room_number.strip():
        rn = room_number.strip().lower()
        serialized = [t for t in serialized if t.room_number.lower() == rn]

    if search and search.strip():
        q = search.strip().lower()
        serialized = [
            t
            for t in serialized
            if q in t.full_name.lower()
            or q in t.mobile.lower()
            or q in t.room_number.lower()
            or q in t.bed_code.lower()
        ]
    return serialized


def get_tenant_detail(db: Session, *, pg_id: int, tenant_id: int) -> TenantSummaryOut:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or tenant.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    return serialize_tenant(db, tenant)


def get_tenant_history(
    db: Session,
    *,
    pg_id: int,
    tenant_id: int,
) -> list[TenantAllocationHistoryOut]:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or tenant.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    rows = db.scalars(
        select(TenantAllocationHistory)
        .where(TenantAllocationHistory.tenant_id == tenant.id)
        .order_by(TenantAllocationHistory.created_at.desc(), TenantAllocationHistory.id.desc())
    ).all()
    return [_serialize_history_row(db, h) for h in rows]


def register_tenant(
    db: Session,
    *,
    pg_id: int,
    actor_user: User,
    body: TenantCreateIn,
) -> TenantCreateOut:
    """Register a new tenant, atomically allocate a vacant bed, create login, deposit & history records."""
    pg = db.get(PGProperty, pg_id)
    if pg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PG property not found.")

    try:
        mobile = normalize_mobile(body.mobile)
        emergency_phone = normalize_mobile(body.emergency_contact_phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    gender_clean = body.gender.strip().lower() if body.gender else None
    if pg.gender_policy == GenderPolicy.MALE and gender_clean and gender_clean != "male":
        raise HTTPException(status_code=422, detail="This PG admits male tenants only.")
    if pg.gender_policy == GenderPolicy.FEMALE and gender_clean and gender_clean != "female":
        raise HTTPException(status_code=422, detail="This PG admits female tenants only.")

    if body.expected_leaving_date is not None and body.expected_leaving_date < body.joining_date:
        raise HTTPException(status_code=422, detail="Expected leaving date cannot precede joining date.")

    bed = db.get(Bed, body.bed_id)
    if bed is None or bed.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected bed not found in this PG.")

    active_same_mobile = db.scalar(
        select(Tenant).where(
            Tenant.pg_id == pg_id,
            Tenant.mobile == mobile,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
    )
    if active_same_mobile is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active tenant with this mobile number is already registered.",
        )

    # Atomic conditional update prevents concurrent duplicate allocation or allocating maintenance beds.
    claim_stmt = (
        update(Bed)
        .where(Bed.id == bed.id, Bed.pg_id == pg_id, Bed.status == BedStatus.VACANT)
        .values(status=BedStatus.OCCUPIED, vacant_since=None)
    )
    claim_result = db.execute(claim_stmt)
    if claim_result.rowcount != 1:
        db.rollback()
        db.refresh(bed)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bed {bed.bed_code} is currently '{bed.status.value}' and cannot be assigned.",
        )

    existing_user = db.scalar(select(User).where(User.mobile == mobile))
    account_created = False
    temp_password: str | None = None

    if existing_user is not None:
        if existing_user.role != UserRole.TENANT:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This mobile number belongs to a PG Owner or Manager account.",
            )
        existing_user.pg_id = pg_id
        existing_user.full_name = body.full_name.strip()
        existing_user.email = str(body.email) if body.email else existing_user.email
        existing_user.is_active = True
        tenant_user = existing_user
    else:
        raw_pw = body.password or secrets.token_urlsafe(8)
        temp_password = raw_pw if body.password is None else None
        tenant_user = User(
            pg_id=pg_id,
            full_name=body.full_name.strip(),
            mobile=mobile,
            email=str(body.email) if body.email else None,
            password_hash=hash_password(raw_pw),
            role=UserRole.TENANT,
            is_active=True,
        )
        db.add(tenant_user)
        db.flush()
        account_created = True

    tenant = Tenant(
        user_id=tenant_user.id,
        pg_id=pg_id,
        room_id=bed.room_id,
        bed_id=bed.id,
        full_name=body.full_name.strip(),
        mobile=mobile,
        email=str(body.email) if body.email else None,
        gender=gender_clean,
        date_of_birth=body.date_of_birth,
        permanent_address=body.permanent_address.strip() if body.permanent_address else None,
        emergency_contact_name=body.emergency_contact_name.strip(),
        emergency_contact_phone=emergency_phone,
        monthly_rent=body.monthly_rent,
        food_charges=body.food_charges,
        security_deposit_amount=body.security_deposit_amount,
        joining_date=body.joining_date,
        expected_leaving_date=body.expected_leaving_date,
        police_verification_status=body.police_verification_status,
        status=TenantStatus.ACTIVE,
        notes=body.notes.strip() if body.notes else None,
        created_by=actor_user.id,
    )
    db.add(tenant)
    db.flush()

    db.add(
        TenantAllocationHistory(
            pg_id=pg_id,
            tenant_id=tenant.id,
            room_id=bed.room_id,
            bed_id=bed.id,
            action="allocated",
            start_date=body.joining_date,
            end_date=None,
            monthly_rent=body.monthly_rent,
            food_charges=body.food_charges,
            remarks="Initial room & bed allocation",
            actor_user_id=actor_user.id,
        )
    )

    now = datetime.now(timezone.utc)
    open_vacancies = db.scalars(
        select(VacancyRecord).where(VacancyRecord.bed_id == bed.id, VacancyRecord.status == VacancyStatus.OPEN)
    ).all()
    for vr in open_vacancies:
        vr.status = VacancyStatus.FILLED
        vr.filled_at = now

    deposit_row = SecurityDeposit(
        tenant_id=tenant.id,
        pg_id=pg_id,
        amount_held=body.security_deposit_amount,
        paid_status=DepositStatus.HELD if body.security_deposit_amount > 0 else DepositStatus.PENDING,
    )
    db.add(deposit_row)
    db.flush()
    if body.security_deposit_amount > 0:
        db.add(
            SecurityDepositTransaction(
                security_deposit_id=deposit_row.id,
                tenant_id=tenant.id,
                pg_id=pg_id,
                transaction_type="deposit_received",
                amount=body.security_deposit_amount,
                payment_method="cash",
                reason="Initial security deposit collected at registration",
                transaction_date=body.joining_date,
                recorded_by=actor_user.id,
            )
        )

    ensure_rent_record_for_period(
        db,
        tenant=tenant,
        pg=pg,
        year=body.joining_date.year,
        month=body.joining_date.month,
    )

    db.commit()
    db.refresh(tenant)
    return TenantCreateOut(
        tenant=serialize_tenant(db, tenant),
        account_created=account_created,
        temporary_password=temp_password,
    )


def update_tenant(
    db: Session,
    *,
    pg_id: int,
    tenant_id: int,
    body: TenantUpdateIn,
    actor_user_id: int | None = None,
) -> TenantSummaryOut:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or tenant.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if tenant.status == TenantStatus.CHECKED_OUT:
        raise HTTPException(status_code=400, detail="Checked-out tenant records cannot be edited.")

    if body.status == TenantStatus.CHECKED_OUT:
        raise HTTPException(status_code=400, detail="Use the checkout endpoint to check out a tenant.")

    if body.full_name is not None:
        tenant.full_name = body.full_name.strip()
        if tenant.user:
            tenant.user.full_name = tenant.full_name
    if body.email is not None:
        tenant.email = str(body.email)
    if body.gender is not None:
        tenant.gender = body.gender.strip().lower()
    if body.date_of_birth is not None:
        tenant.date_of_birth = body.date_of_birth
    if body.permanent_address is not None:
        tenant.permanent_address = body.permanent_address.strip() or None
    if body.expected_leaving_date is not None:
        tenant.expected_leaving_date = body.expected_leaving_date
    if body.monthly_rent is not None:
        tenant.monthly_rent = body.monthly_rent
    if body.food_charges is not None:
        tenant.food_charges = body.food_charges
    if body.emergency_contact_name is not None:
        tenant.emergency_contact_name = body.emergency_contact_name.strip()
    if body.emergency_contact_phone is not None:
        try:
            tenant.emergency_contact_phone = normalize_mobile(body.emergency_contact_phone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if body.police_verification_status is not None:
        tenant.police_verification_status = body.police_verification_status
    if body.notes is not None:
        tenant.notes = body.notes.strip() or None

    bed = db.get(Bed, tenant.bed_id)
    if body.status is not None and body.status != tenant.status:
        tenant.status = body.status
        today = datetime.now(timezone.utc).date()
        if body.status == TenantStatus.NOTICE_PERIOD:
            tenant.notice_date = body.notice_date or today
            if bed:
                bed.status = BedStatus.NOTICE_PERIOD
            db.add(
                TenantAllocationHistory(
                    pg_id=pg_id,
                    tenant_id=tenant.id,
                    room_id=tenant.room_id,
                    bed_id=tenant.bed_id,
                    action="notice_period",
                    start_date=tenant.notice_date,
                    monthly_rent=tenant.monthly_rent,
                    food_charges=tenant.food_charges,
                    remarks="Moved to notice period",
                    actor_user_id=actor_user_id,
                )
            )
        elif body.status == TenantStatus.ACTIVE:
            tenant.notice_date = None
            if bed:
                bed.status = BedStatus.OCCUPIED
            db.add(
                TenantAllocationHistory(
                    pg_id=pg_id,
                    tenant_id=tenant.id,
                    room_id=tenant.room_id,
                    bed_id=tenant.bed_id,
                    action="re_activated",
                    start_date=today,
                    monthly_rent=tenant.monthly_rent,
                    food_charges=tenant.food_charges,
                    remarks="Returned to active occupancy",
                    actor_user_id=actor_user_id,
                )
            )
    elif body.notice_date is not None:
        tenant.notice_date = body.notice_date

    db.commit()
    db.refresh(tenant)
    return serialize_tenant(db, tenant)


async def upload_tenant_document(
    db: Session,
    *,
    pg_id: int,
    tenant_id: int,
    doc_type: DocumentType,
    file: UploadFile,
    uploaded_by: User,
) -> TenantDocumentOut:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or tenant.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    orig_name, rel_path, mime = await save_upload_file(
        file,
        subfolder=f"tenants/{tenant.id}",
        allowed_extensions=ALLOWED_DOC_EXTENSIONS,
    )
    doc = TenantDocument(
        tenant_id=tenant.id,
        doc_type=doc_type,
        file_name=orig_name,
        file_path=rel_path,
        mime_type=mime,
        uploaded_by=uploaded_by.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return TenantDocumentOut(
        id=doc.id,
        doc_type=doc.doc_type,
        file_name=doc.file_name,
        mime_type=doc.mime_type,
        uploaded_at=doc.uploaded_at,
        url=f"/api/files/tenant-docs/{doc.id}",
    )


def checkout_tenant(
    db: Session,
    *,
    pg_id: int,
    tenant_id: int,
    body: TenantCheckoutIn,
    actor_user_id: int | None = None,
) -> TenantCheckoutOut:
    """Complete tenant checkout: record leaving date & remarks, settle deposit, release bed & preserve history."""
    tenant = db.get(Tenant, tenant_id)
    if tenant is None or tenant.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if tenant.status == TenantStatus.CHECKED_OUT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant is already checked out.")
    if body.leaving_date < tenant.joining_date:
        raise HTTPException(status_code=422, detail="Leaving date cannot precede joining date.")

    remarks_text = (body.checkout_remarks or body.notes or "").strip() or None
    now = datetime.now(timezone.utc)
    tenant.leaving_date = body.leaving_date
    tenant.status = TenantStatus.CHECKED_OUT
    tenant.checkout_remarks = remarks_text
    if remarks_text:
        tenant.notes = f"{tenant.notes}\nCheckout: {remarks_text}".strip() if tenant.notes else remarks_text

    bed = db.get(Bed, tenant.bed_id)
    if bed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned bed not found.")

    if body.mark_bed_maintenance:
        bed.status = BedStatus.MAINTENANCE
        bed.vacant_since = None
    else:
        bed.status = BedStatus.VACANT
        bed.vacant_since = now
        db.add(
            VacancyRecord(
                pg_id=pg_id,
                bed_id=bed.id,
                previous_tenant_id=tenant.id,
                vacant_from=now,
                monthly_rent_snapshot=bed.monthly_rent,
                status=VacancyStatus.OPEN,
            )
        )

    # Close open allocation history row and append checkout history entry
    open_hist = db.scalars(
        select(TenantAllocationHistory).where(
            TenantAllocationHistory.tenant_id == tenant.id,
            TenantAllocationHistory.end_date.is_(None),
            TenantAllocationHistory.action == "allocated",
        )
    ).all()
    for row in open_hist:
        row.end_date = body.leaving_date

    db.add(
        TenantAllocationHistory(
            pg_id=pg_id,
            tenant_id=tenant.id,
            room_id=tenant.room_id,
            bed_id=tenant.bed_id,
            action="checked_out",
            start_date=tenant.joining_date,
            end_date=body.leaving_date,
            monthly_rent=tenant.monthly_rent,
            food_charges=tenant.food_charges,
            remarks=remarks_text or "Tenant checked out",
            actor_user_id=actor_user_id,
        )
    )

    deposit = db.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant.id))
    held = Decimal(deposit.amount_held) if deposit else Decimal(tenant.security_deposit_amount)
    already_deducted = Decimal(deposit.deduction_amount) if deposit else Decimal("0.00")
    already_refunded = Decimal(deposit.refund_amount) if deposit else Decimal("0.00")
    available_balance = max(Decimal("0.00"), held - already_deducted - already_refunded)

    if body.deduction_amount > available_balance:
        raise HTTPException(
            status_code=422,
            detail=f"Deduction amount ({body.deduction_amount}) cannot exceed refundable deposit balance ({available_balance}).",
        )
    refund = max(Decimal("0.00"), available_balance - Decimal(body.deduction_amount))
    total_deductions = already_deducted + Decimal(body.deduction_amount)
    total_refunded = already_refunded + refund
    dep_status = DepositStatus.REFUNDED if total_deductions == 0 else DepositStatus.PARTIALLY_REFUNDED

    if deposit is None:
        deposit = SecurityDeposit(
            tenant_id=tenant.id,
            pg_id=pg_id,
            amount_held=held,
            paid_status=dep_status,
            deduction_amount=total_deductions,
            deduction_reason=body.deduction_reason.strip() if body.deduction_reason else None,
            refund_amount=total_refunded,
            refund_date=body.leaving_date,
            notes=remarks_text,
        )
        db.add(deposit)
        db.flush()
    else:
        deposit.deduction_amount = total_deductions
        if body.deduction_reason:
            deposit.deduction_reason = body.deduction_reason.strip()
        deposit.refund_amount = total_refunded
        deposit.refund_date = body.leaving_date
        deposit.paid_status = dep_status
        deposit.notes = remarks_text or deposit.notes

    if body.deduction_amount > Decimal("0.00"):
        db.add(
            SecurityDepositTransaction(
                security_deposit_id=deposit.id,
                tenant_id=tenant.id,
                pg_id=pg_id,
                transaction_type="deduction",
                amount=body.deduction_amount,
                reason=body.deduction_reason.strip() if body.deduction_reason else "Checkout deduction",
                transaction_date=body.leaving_date,
                recorded_by=actor_user_id,
            )
        )
    if refund > Decimal("0.00"):
        db.add(
            SecurityDepositTransaction(
                security_deposit_id=deposit.id,
                tenant_id=tenant.id,
                pg_id=pg_id,
                transaction_type="refund",
                amount=refund,
                payment_method="bank_transfer",
                reason="Checkout security deposit refund",
                transaction_date=body.leaving_date,
                recorded_by=actor_user_id,
            )
        )

    db.commit()
    db.refresh(tenant)
    db.refresh(bed)

    return TenantCheckoutOut(
        tenant=serialize_tenant(db, tenant),
        deposit_held=held,
        deduction_amount=body.deduction_amount,
        refund_amount=refund,
        deposit_status=dep_status,
        bed_code=bed.bed_code,
        bed_status=bed.status,
    )


def update_bed_operational_status(
    db: Session,
    *,
    pg_id: int,
    bed_id: int,
    new_status: BedStatus,
) -> dict:
    bed = db.get(Bed, bed_id)
    if bed is None or bed.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bed not found.")

    if new_status == BedStatus.OCCUPIED:
        raise HTTPException(
            status_code=400,
            detail="Register a tenant to mark a bed as occupied.",
        )

    active_tenant = db.scalar(
        select(Tenant).where(
            Tenant.bed_id == bed.id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
    )
    if active_tenant is not None and new_status in (BedStatus.VACANT, BedStatus.MAINTENANCE):
        raise HTTPException(
            status_code=409,
            detail="Cannot mark an occupied bed vacant/maintenance before checking out its tenant.",
        )

    now = datetime.now(timezone.utc)
    if new_status == BedStatus.VACANT and bed.status != BedStatus.VACANT:
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
        open_vacancies = db.scalars(
            select(VacancyRecord).where(
                VacancyRecord.bed_id == bed.id,
                VacancyRecord.status == VacancyStatus.OPEN,
            )
        ).all()
        for v in open_vacancies:
            v.status = VacancyStatus.FILLED
            v.filled_at = now

    bed.status = new_status
    db.commit()
    db.refresh(bed)
    return {
        "id": bed.id,
        "bed_code": bed.bed_code,
        "status": bed.status.value,
        "is_publicly_available": bed.is_publicly_available,
    }
