from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_manager_or_owner
from app.models.complaint import Complaint
from app.models.enums import (
    BedStatus,
    ComplaintCategory,
    ComplaintStatus,
    DocumentType,
    TenantStatus,
)
from app.models.property import Bed
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    BedStatusUpdateIn,
    ComplaintOut,
    ComplaintStatusUpdateIn,
    FoodMenuBulkUpdateIn,
    FoodMenuPublishIn,
    FoodMenuSlotOut,
    FoodMenuSlotPatchIn,
    ManagerComplaintSummaryOut,
    ManagerFoodOverviewOut,
    TenantCheckoutIn,
    TenantCheckoutOut,
    TenantCreateIn,
    TenantCreateOut,
    TenantDocumentOut,
    TenantSummaryOut,
    TenantUpdateIn,
)
from app.services.complaint_service import (
    get_complaint_detail_for_user,
    list_manager_complaints,
    update_complaint_status,
)
from app.services.food_service import (
    bulk_update_food_menu,
    get_manager_food_overview,
    patch_food_menu_slot,
    publish_weekly_menu,
    upload_food_menu_image,
)
from app.services.tenant_lifecycle_service import (
    checkout_tenant,
    list_pg_rooms_with_beds,
    list_tenants,
    register_tenant,
    update_bed_operational_status,
    update_tenant,
    upload_tenant_document,
)

router = APIRouter(prefix="/manager", tags=["Manager"])


def _require_pg_id(user: User) -> int:
    if user.pg_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No PG property assigned to this account.",
        )
    return user.pg_id


@router.get("/overview")
def get_manager_overview(
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Operational overview for PG Managers (excludes owner financial analytics/settings)."""
    pg_id = _require_pg_id(current_user)
    active_tenants = db.scalar(
        select(func.count(Tenant.id)).where(
            Tenant.pg_id == pg_id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
    ) or 0
    vacant_beds = db.scalar(
        select(func.count(Bed.id)).where(Bed.pg_id == pg_id, Bed.status == BedStatus.VACANT)
    ) or 0
    open_complaints = db.scalar(
        select(func.count(Complaint.id)).where(
            Complaint.pg_id == pg_id,
            Complaint.status != ComplaintStatus.RESOLVED,
        )
    ) or 0

    return {
        "pg_id": pg_id,
        "manager_name": current_user.full_name,
        "active_tenants": active_tenants,
        "vacant_beds": vacant_beds,
        "open_complaints": open_complaints,
    }


@router.get("/rooms")
def get_manager_rooms(
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[dict]:
    pg_id = _require_pg_id(current_user)
    return list_pg_rooms_with_beds(db, pg_id=pg_id)


@router.patch("/beds/{bed_id}/status")
def set_bed_status(
    bed_id: int,
    body: BedStatusUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> dict:
    pg_id = _require_pg_id(current_user)
    return update_bed_operational_status(db, pg_id=pg_id, bed_id=bed_id, new_status=body.status)


@router.get("/tenants", response_model=list[TenantSummaryOut])
def get_tenants(
    status_filter: TenantStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[TenantSummaryOut]:
    pg_id = _require_pg_id(current_user)
    return list_tenants(db, pg_id=pg_id, status_filter=status_filter, search=search)


@router.post("/tenants", response_model=TenantCreateOut)
def onboard_tenant(
    body: TenantCreateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantCreateOut:
    pg_id = _require_pg_id(current_user)
    return register_tenant(db, pg_id=pg_id, actor_user=current_user, body=body)


@router.patch("/tenants/{tenant_id}", response_model=TenantSummaryOut)
def edit_tenant(
    tenant_id: int,
    body: TenantUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantSummaryOut:
    pg_id = _require_pg_id(current_user)
    return update_tenant(db, pg_id=pg_id, tenant_id=tenant_id, body=body)


@router.post("/tenants/{tenant_id}/documents", response_model=TenantDocumentOut)
async def add_tenant_document(
    tenant_id: int,
    doc_type: DocumentType = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantDocumentOut:
    pg_id = _require_pg_id(current_user)
    return await upload_tenant_document(
        db,
        pg_id=pg_id,
        tenant_id=tenant_id,
        doc_type=doc_type,
        file=file,
        uploaded_by=current_user,
    )


@router.post("/tenants/{tenant_id}/checkout", response_model=TenantCheckoutOut)
def process_tenant_checkout(
    tenant_id: int,
    body: TenantCheckoutIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantCheckoutOut:
    pg_id = _require_pg_id(current_user)
    return checkout_tenant(db, pg_id=pg_id, tenant_id=tenant_id, body=body)


@router.get("/complaints", response_model=ManagerComplaintSummaryOut)
def get_complaints(
    status_group: str | None = Query(default=None),
    status_filter: ComplaintStatus | None = Query(default=None, alias="status"),
    category: ComplaintCategory | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_order: Literal["desc", "asc"] = Query(default="desc"),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> ManagerComplaintSummaryOut:
    pg_id = _require_pg_id(current_user)
    return list_manager_complaints(
        db,
        pg_id=pg_id,
        status_group=status_group,
        status_filter=status_filter,
        category=category,
        search=search,
        sort_order=sort_order,
    )


@router.get("/complaints/{complaint_id}", response_model=ComplaintOut)
def get_complaint_detail(
    complaint_id: int,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> ComplaintOut:
    return get_complaint_detail_for_user(db, current_user=current_user, complaint_id=complaint_id)


@router.patch("/complaints/{complaint_id}/status", response_model=ComplaintOut)
def change_complaint_status(
    complaint_id: int,
    body: ComplaintStatusUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> ComplaintOut:
    pg_id = _require_pg_id(current_user)
    return update_complaint_status(
        db,
        pg_id=pg_id,
        manager_user=current_user,
        complaint_id=complaint_id,
        body=body,
    )


@router.get("/food/menu", response_model=ManagerFoodOverviewOut)
def get_food_overview(
    target_date: date | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> ManagerFoodOverviewOut:
    pg_id = _require_pg_id(current_user)
    return get_manager_food_overview(db, pg_id=pg_id, target_date=target_date)


@router.put("/food/menu", response_model=list[FoodMenuSlotOut])
def update_food_menu(
    body: FoodMenuBulkUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[FoodMenuSlotOut]:
    pg_id = _require_pg_id(current_user)
    return bulk_update_food_menu(db, pg_id=pg_id, manager_user=current_user, body=body)


@router.patch("/food/menu/{menu_id}", response_model=FoodMenuSlotOut)
def patch_food_slot(
    menu_id: int,
    body: FoodMenuSlotPatchIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> FoodMenuSlotOut:
    pg_id = _require_pg_id(current_user)
    return patch_food_menu_slot(
        db,
        pg_id=pg_id,
        menu_id=menu_id,
        manager_user=current_user,
        body=body,
    )


@router.post("/food/menu/{menu_id}/image", response_model=FoodMenuSlotOut)
async def upload_food_slot_image(
    menu_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> FoodMenuSlotOut:
    pg_id = _require_pg_id(current_user)
    return await upload_food_menu_image(
        db,
        pg_id=pg_id,
        menu_id=menu_id,
        manager_user=current_user,
        file=file,
    )


@router.post("/food/menu/publish", response_model=list[FoodMenuSlotOut])
def publish_food_menu(
    body: FoodMenuPublishIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[FoodMenuSlotOut]:
    pg_id = _require_pg_id(current_user)
    return publish_weekly_menu(
        db,
        pg_id=pg_id,
        manager_user=current_user,
        is_published=body.is_published,
    )
