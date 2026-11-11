from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_tenant, get_current_user
from app.models.enums import ComplaintCategory
from app.models.notification import Notification
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    ComplaintOut,
    ComplaintRateIn,
    CreatePaymentOrderIn,
    CreatePaymentOrderOut,
    MealRatingCreateIn,
    MealRatingOut,
    MealSkipCreateIn,
    MealSkipOut,
    PaymentOut,
    ReceiptDetailOut,
    TenantComplaintSummaryOut,
    TenantFoodOverviewOut,
    TenantRentSummaryOut,
    VerifyPaymentIn,
)
from app.services.complaint_service import (
    create_tenant_complaint,
    get_complaint_detail_for_user,
    get_tenant_complaint_summary,
    list_tenant_complaints,
    rate_resolved_complaint,
)
from app.services.food_service import (
    cancel_meal_skip,
    create_meal_skip,
    get_tenant_food_overview,
    upsert_meal_rating,
)
from app.services.payment_service import (
    build_receipt_pdf,
    create_payment_order,
    get_receipt_detail,
    get_tenant_rent_summary,
    verify_payment,
)

router = APIRouter(prefix="/tenant", tags=["Tenant"])


@router.get("/profile")
def get_my_tenant_profile(tenant: Tenant = Depends(get_current_tenant)) -> dict:
    """Return authenticated tenant's own occupancy & rent terms (strictly tenant-isolated)."""
    return {
        "tenant_id": tenant.id,
        "full_name": tenant.full_name,
        "mobile": tenant.mobile,
        "email": tenant.email,
        "room_number": tenant.room.room_number if tenant.room else None,
        "bed_code": tenant.bed.bed_code if tenant.bed else None,
        "monthly_rent": str(tenant.monthly_rent),
        "food_charges": str(tenant.food_charges),
        "security_deposit_amount": str(tenant.security_deposit_amount),
        "joining_date": tenant.joining_date.isoformat(),
        "status": tenant.status.value,
    }


@router.get("/rent/summary", response_model=TenantRentSummaryOut)
def get_rent_summary(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantRentSummaryOut:
    return get_tenant_rent_summary(db, tenant)


@router.post("/rent/payments/create-order", response_model=CreatePaymentOrderOut)
def create_rent_payment_order(
    body: CreatePaymentOrderIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> CreatePaymentOrderOut:
    return create_payment_order(db, tenant=tenant, body=body)


@router.post("/rent/payments/verify", response_model=PaymentOut)
def verify_rent_payment(
    body: VerifyPaymentIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> PaymentOut:
    return verify_payment(db, tenant=tenant, body=body)


@router.get("/rent/receipts/{payment_id}", response_model=ReceiptDetailOut)
def get_rent_receipt(
    payment_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> ReceiptDetailOut:
    return get_receipt_detail(db, payment_id=payment_id, tenant_id_filter=tenant.id)


@router.get("/rent/receipts/{payment_id}/download")
def download_rent_receipt_pdf(
    payment_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> Response:
    detail = get_receipt_detail(db, payment_id=payment_id, tenant_id_filter=tenant.id)
    pdf_bytes = build_receipt_pdf(detail)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{detail.receipt_number}.pdf"'},
    )


@router.get("/complaints", response_model=list[ComplaintOut])
def get_my_complaints(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[ComplaintOut]:
    return list_tenant_complaints(db, tenant)


@router.get("/complaints/summary", response_model=TenantComplaintSummaryOut)
def get_my_complaints_summary(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantComplaintSummaryOut:
    return get_tenant_complaint_summary(db, tenant)


@router.get("/complaints/{complaint_id}", response_model=ComplaintOut)
def get_my_complaint_detail(
    complaint_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ComplaintOut:
    return get_complaint_detail_for_user(db, current_user=current_user, complaint_id=complaint_id)


@router.post("/complaints", response_model=ComplaintOut)
async def submit_complaint(
    category: ComplaintCategory = Form(...),
    title: str = Form(..., min_length=3, max_length=160),
    description: str = Form(default="", max_length=2000),
    image: UploadFile | None = File(default=None),
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> ComplaintOut:
    return await create_tenant_complaint(
        db,
        tenant=tenant,
        category=category,
        title=title,
        description=description,
        image=image,
    )


@router.post("/complaints/{complaint_id}/rate", response_model=ComplaintOut)
def rate_complaint(
    complaint_id: int,
    body: ComplaintRateIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> ComplaintOut:
    return rate_resolved_complaint(db, tenant=tenant, complaint_id=complaint_id, body=body)


@router.get("/food/menu", response_model=TenantFoodOverviewOut)
def get_food_menu_overview(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantFoodOverviewOut:
    return get_tenant_food_overview(db, tenant)


@router.post("/food/skip", response_model=MealSkipOut)
def skip_meal(
    body: MealSkipCreateIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> MealSkipOut:
    return create_meal_skip(db, tenant, body)


@router.delete("/food/skip/{skip_id}")
def undo_skip_meal(
    skip_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    return cancel_meal_skip(db, tenant, skip_id)


@router.post("/food/rate", response_model=MealRatingOut)
def rate_meal(
    body: MealRatingCreateIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> MealRatingOut:
    return upsert_meal_rating(db, tenant, body)


@router.get("/notifications")
def list_my_notifications(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == tenant.user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(30)
    ).all()
    return [
        {
            "id": n.id,
            "notif_type": n.notif_type.value,
            "title": n.title,
            "message": n.message,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat(),
        }
        for n in rows
    ]


@router.post("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    notif = db.get(Notification, notif_id)
    if notif is not None and notif.user_id == tenant.user_id:
        notif.is_read = True
        db.commit()
    return {"message": "Notification marked as read."}
