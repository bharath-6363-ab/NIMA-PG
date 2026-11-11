from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_tenant, get_current_user, require_manager_or_owner
from app.models.enums import RentStatus, UserRole
from app.models.finance import Payment, RentRecord, SecurityDeposit
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    CreatePaymentOrderIn,
    CreatePaymentOrderOut,
    DepositTransactionCreateIn,
    FailPaymentIn,
    GenerateRentIn,
    GenerateRentOut,
    OfflinePaymentIn,
    PaymentOut,
    ReceiptDetailOut,
    RentRecordOut,
    RentRecordUpdateIn,
    SecurityDepositOut,
    TenantRentSummaryOut,
    VerifyPaymentIn,
)
from app.services.payment_service import (
    build_receipt_pdf,
    create_payment_order,
    generate_monthly_rent_records,
    get_receipt_detail,
    get_tenant_rent_summary,
    list_pg_rent_records,
    mark_gateway_payment_failed,
    record_deposit_transaction,
    record_offline_payment,
    serialize_deposit,
    sync_rent_record_status,
    to_payment_out,
    to_rent_record_out,
    update_rent_record_charges,
    verify_payment,
)

rent_router = APIRouter(prefix="/rent", tags=["Rent Management"])
payments_router = APIRouter(prefix="/payments", tags=["Payments"])
receipts_router = APIRouter(prefix="/receipts", tags=["Receipts"])
deposits_router = APIRouter(prefix="/deposits", tags=["Security Deposits"])


def _require_pg_id(user: User) -> int:
    if user.pg_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No PG property assigned to this account.",
        )
    return user.pg_id


def _assert_tenant_access(db: Session, current_user: User, tenant_id: int) -> Tenant:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    if current_user.role == UserRole.TENANT:
        if tenant.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    elif current_user.pg_id != tenant.pg_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    return tenant


# ---------------------------------------------------------------------------
# Rent Management (/api/rent)
# ---------------------------------------------------------------------------
@rent_router.get("/my", response_model=TenantRentSummaryOut)
def api_get_my_rent(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantRentSummaryOut:
    """Return authenticated tenant's own rent, previous bills, payments, and deposit."""
    return get_tenant_rent_summary(db, tenant)


@rent_router.post("/generate", response_model=GenerateRentOut)
def api_generate_monthly_rent(
    body: GenerateRentIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> GenerateRentOut:
    """Generate monthly rent records idempotently for eligible tenants in PG."""
    pg_id = _require_pg_id(current_user)
    return generate_monthly_rent_records(
        db,
        pg_id=pg_id,
        billing_month=body.billing_month,
        billing_year=body.billing_year,
    )


@rent_router.get("/records", response_model=list[RentRecordOut])
def api_list_rent_records(
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2020, le=2100),
    status_filter: RentStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[RentRecordOut]:
    pg_id = _require_pg_id(current_user)
    return list_pg_rent_records(
        db,
        pg_id=pg_id,
        month=month,
        year=year,
        status_filter=status_filter,
        search=search,
    )


@rent_router.get("/records/outstanding", response_model=list[RentRecordOut])
def api_list_outstanding_rent(
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2020, le=2100),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[RentRecordOut]:
    pg_id = _require_pg_id(current_user)
    return list_pg_rent_records(
        db,
        pg_id=pg_id,
        month=month,
        year=year,
        search=search,
        outstanding_only=True,
    )


@rent_router.get("/records/{rent_record_id}", response_model=RentRecordOut)
def api_get_rent_record(
    rent_record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RentRecordOut:
    rec = db.get(RentRecord, rent_record_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Rent record not found.")
    _assert_tenant_access(db, current_user, rec.tenant_id)
    sync_rent_record_status(rec)
    db.commit()
    return to_rent_record_out(db, rec)


@rent_router.patch("/records/{rent_record_id}", response_model=RentRecordOut)
def api_update_rent_record(
    rent_record_id: int,
    body: RentRecordUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> RentRecordOut:
    pg_id = _require_pg_id(current_user)
    return update_rent_record_charges(
        db,
        pg_id=pg_id,
        rent_record_id=rent_record_id,
        body=body,
    )


@rent_router.get("/tenants/{tenant_id}/history", response_model=list[RentRecordOut])
def api_get_tenant_rent_history(
    tenant_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RentRecordOut]:
    tenant = _assert_tenant_access(db, current_user, tenant_id)
    rows = db.scalars(
        select(RentRecord)
        .where(RentRecord.tenant_id == tenant.id)
        .order_by(RentRecord.billing_year.desc(), RentRecord.billing_month.desc())
    ).all()
    for r in rows:
        sync_rent_record_status(r)
    db.commit()
    return [to_rent_record_out(db, r) for r in rows]


# ---------------------------------------------------------------------------
# Payments (/api/payments)
# ---------------------------------------------------------------------------
@payments_router.post("/orders", response_model=CreatePaymentOrderOut)
def api_initiate_payment_order(
    body: CreatePaymentOrderIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> CreatePaymentOrderOut:
    return create_payment_order(db, tenant=tenant, body=body)


@payments_router.post("/verify", response_model=PaymentOut)
def api_verify_gateway_payment(
    body: VerifyPaymentIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> PaymentOut:
    return verify_payment(db, tenant=tenant, body=body)


@payments_router.post("/fail", response_model=PaymentOut)
def api_fail_gateway_payment(
    body: FailPaymentIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> PaymentOut:
    return mark_gateway_payment_failed(db, tenant=tenant, body=body)


@payments_router.post("/offline", response_model=PaymentOut)
def api_record_offline_payment(
    body: OfflinePaymentIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> PaymentOut:
    pg_id = _require_pg_id(current_user)
    return record_offline_payment(db, pg_id=pg_id, actor=current_user, body=body)


@payments_router.get("", response_model=list[PaymentOut])
def api_list_payments(
    tenant_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PaymentOut]:
    if current_user.role == UserRole.TENANT:
        t = db.scalar(
            select(Tenant).where(Tenant.user_id == current_user.id).order_by(Tenant.id.desc())
        )
        if t is None:
            return []
        if tenant_id is not None and tenant_id != t.id:
            raise HTTPException(status_code=403, detail="Cannot access another tenant's payment history.")
        rows = db.scalars(
            select(Payment)
            .where(Payment.tenant_id == t.id)
            .order_by(Payment.created_at.desc(), Payment.id.desc())
        ).all()
        return [to_payment_out(db, p) for p in rows]

    pg_id = _require_pg_id(current_user)
    query = select(Payment).where(Payment.pg_id == pg_id).order_by(Payment.created_at.desc(), Payment.id.desc())
    if tenant_id is not None:
        _assert_tenant_access(db, current_user, tenant_id)
        query = query.where(Payment.tenant_id == tenant_id)
    rows = db.scalars(query).all()
    return [to_payment_out(db, p) for p in rows]


@payments_router.get("/{payment_id}", response_model=PaymentOut)
def api_get_payment_detail(
    payment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaymentOut:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found.")
    _assert_tenant_access(db, current_user, payment.tenant_id)
    return to_payment_out(db, payment)


# ---------------------------------------------------------------------------
# Receipts (/api/receipts)
# ---------------------------------------------------------------------------
@receipts_router.get("/{payment_id}", response_model=ReceiptDetailOut)
def api_get_receipt_details(
    payment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReceiptDetailOut:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")
    _assert_tenant_access(db, current_user, payment.tenant_id)
    return get_receipt_detail(db, payment_id=payment_id)


@receipts_router.get("/{payment_id}/download")
def api_download_receipt_pdf(
    payment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")
    _assert_tenant_access(db, current_user, payment.tenant_id)
    detail = get_receipt_detail(db, payment_id=payment_id)
    pdf_bytes = build_receipt_pdf(detail)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{detail.receipt_number}.pdf"'},
    )


# ---------------------------------------------------------------------------
# Security Deposits (/api/deposits)
# ---------------------------------------------------------------------------
@deposits_router.get("/my", response_model=SecurityDepositOut)
def api_get_my_deposit(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> SecurityDepositOut:
    deposit = db.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant.id))
    if deposit is None:
        raise HTTPException(status_code=404, detail="Security deposit record not found.")
    return serialize_deposit(db, deposit)


@deposits_router.get("", response_model=list[SecurityDepositOut])
def api_list_deposits(
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[SecurityDepositOut]:
    pg_id = _require_pg_id(current_user)
    rows = db.scalars(
        select(SecurityDeposit)
        .where(SecurityDeposit.pg_id == pg_id)
        .order_by(SecurityDeposit.id.desc())
    ).all()
    return [serialize_deposit(db, d) for d in rows]


@deposits_router.get("/{tenant_id}", response_model=SecurityDepositOut)
def api_get_tenant_deposit(
    tenant_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SecurityDepositOut:
    tenant = _assert_tenant_access(db, current_user, tenant_id)
    deposit = db.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant.id))
    if deposit is None:
        raise HTTPException(status_code=404, detail="Security deposit record not found.")
    return serialize_deposit(db, deposit)


@deposits_router.post("/{tenant_id}/transactions", response_model=SecurityDepositOut)
def api_record_deposit_transaction(
    tenant_id: int,
    body: DepositTransactionCreateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> SecurityDepositOut:
    pg_id = _require_pg_id(current_user)
    return record_deposit_transaction(
        db,
        pg_id=pg_id,
        tenant_id=tenant_id,
        actor=current_user,
        body=body,
    )

