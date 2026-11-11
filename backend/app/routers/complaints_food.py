from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_tenant, get_current_user, require_manager_or_owner
from app.models.enums import ComplaintCategory, ComplaintStatus
from app.models.notification import Notification
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    ComplaintOut,
    ComplaintRateIn,
    ComplaintStatusUpdateIn,
    FoodMenuBulkUpdateIn,
    FoodMenuPublishIn,
    FoodMenuSlotOut,
    FoodMenuSlotPatchIn,
    ManagerComplaintSummaryOut,
    ManagerFoodOverviewOut,
    MealRatingCreateIn,
    MealRatingOut,
    MealSkipCreateIn,
    MealSkipOut,
    NotificationOut,
    TenantComplaintSummaryOut,
    TenantFoodOverviewOut,
)
from app.services.complaint_service import (
    create_tenant_complaint,
    get_complaint_detail_for_user,
    get_tenant_complaint_summary,
    list_manager_complaints,
    rate_resolved_complaint,
    update_complaint_status,
)
from app.services.food_service import (
    bulk_update_food_menu,
    cancel_meal_skip,
    create_meal_skip,
    get_manager_food_overview,
    get_tenant_food_overview,
    patch_food_menu_slot,
    publish_weekly_menu,
    upload_food_menu_image,
    upsert_meal_rating,
)

complaints_router = APIRouter(prefix="/complaints", tags=["Complaints"])
food_router = APIRouter(prefix="/food", tags=["Food Management"])
notifications_router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _require_pg_id(user: User) -> int:
    if user.pg_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No PG property assigned to this account.",
        )
    return user.pg_id


# ---------------------------------------------------------------------------
# Complaints (/api/complaints)
# ---------------------------------------------------------------------------
@complaints_router.get("/my", response_model=TenantComplaintSummaryOut)
def api_get_my_complaints_summary(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantComplaintSummaryOut:
    return get_tenant_complaint_summary(db, tenant)


@complaints_router.post("", response_model=ComplaintOut)
async def api_submit_complaint(
    category: ComplaintCategory = Form(...),
    title: str = Form(..., min_length=3, max_length=160),
    description: str = Form(..., min_length=5, max_length=2000),
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


@complaints_router.get("", response_model=ManagerComplaintSummaryOut)
def api_list_pg_complaints(
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


@complaints_router.get("/{complaint_id}", response_model=ComplaintOut)
def api_get_complaint_detail(
    complaint_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ComplaintOut:
    return get_complaint_detail_for_user(
        db,
        current_user=current_user,
        complaint_id=complaint_id,
    )


@complaints_router.patch("/{complaint_id}/status", response_model=ComplaintOut)
def api_update_complaint_status(
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


@complaints_router.post("/{complaint_id}/rate", response_model=ComplaintOut)
def api_rate_complaint(
    complaint_id: int,
    body: ComplaintRateIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> ComplaintOut:
    return rate_resolved_complaint(db, tenant=tenant, complaint_id=complaint_id, body=body)


# ---------------------------------------------------------------------------
# Food Menu, Skips & Ratings (/api/food)
# ---------------------------------------------------------------------------
@food_router.get("/tenant", response_model=TenantFoodOverviewOut)
def api_get_tenant_food(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantFoodOverviewOut:
    return get_tenant_food_overview(db, tenant)


@food_router.get("/manager", response_model=ManagerFoodOverviewOut)
def api_get_manager_food(
    target_date: date | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> ManagerFoodOverviewOut:
    pg_id = _require_pg_id(current_user)
    return get_manager_food_overview(db, pg_id=pg_id, target_date=target_date)


@food_router.put("/menu", response_model=list[FoodMenuSlotOut])
def api_upsert_weekly_menu(
    body: FoodMenuBulkUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[FoodMenuSlotOut]:
    pg_id = _require_pg_id(current_user)
    return bulk_update_food_menu(db, pg_id=pg_id, manager_user=current_user, body=body)


@food_router.patch("/menu/{menu_id}", response_model=FoodMenuSlotOut)
def api_patch_single_meal(
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


@food_router.post("/menu/{menu_id}/image", response_model=FoodMenuSlotOut)
async def api_upload_meal_image(
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


@food_router.post("/menu/publish", response_model=list[FoodMenuSlotOut])
def api_publish_menu(
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


@food_router.post("/skips", response_model=MealSkipOut)
def api_submit_meal_skip(
    body: MealSkipCreateIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> MealSkipOut:
    return create_meal_skip(db, tenant, body)


@food_router.delete("/skips/{skip_id}")
def api_delete_meal_skip(
    skip_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    return cancel_meal_skip(db, tenant, skip_id)


@food_router.post("/skips/{skip_id}/cancel")
def api_cancel_meal_skip(
    skip_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    return cancel_meal_skip(db, tenant, skip_id)


@food_router.post("/ratings", response_model=MealRatingOut)
def api_submit_meal_rating(
    body: MealRatingCreateIn,
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> MealRatingOut:
    return upsert_meal_rating(db, tenant, body)


# ---------------------------------------------------------------------------
# Notifications (/api/notifications)
# ---------------------------------------------------------------------------
@notifications_router.get("", response_model=list[NotificationOut])
def api_list_my_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[NotificationOut]:
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(30)
    ).all()
    return [
        NotificationOut(
            id=n.id,
            notif_type=n.notif_type.value,
            title=n.title,
            message=n.message,
            is_read=n.is_read,
            created_at=n.created_at,
        )
        for n in rows
    ]


@notifications_router.post("/{notif_id}/read")
def api_mark_notification_read(
    notif_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    notif = db.get(Notification, notif_id)
    if notif is not None and notif.user_id == current_user.id:
        notif.is_read = True
        db.commit()
    return {"message": "Notification marked as read."}


@notifications_router.post("/read-all")
def api_mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    rows = db.scalars(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read.is_(False),
        )
    ).all()
    for n in rows:
        n.is_read = True
    db.commit()
    return {"message": "All notifications marked as read."}

