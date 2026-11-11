from datetime import date, datetime, time, timezone

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.enums import DayOfWeek, MealType
from app.models.food import FoodMenu, FoodMenuItem, MealRating, MealSkipRequest
from app.models.property import Bed, PGProperty, Room
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    FoodMenuBulkUpdateIn,
    FoodMenuItemIn,
    FoodMenuItemOut,
    FoodMenuSlotOut,
    FoodMenuSlotPatchIn,
    ManagerFoodOverviewOut,
    MealRatingCreateIn,
    MealRatingOut,
    MealSkipCreateIn,
    MealSkipOut,
    TenantFoodOverviewOut,
)
from app.services.storage_service import ALLOWED_IMAGE_EXTENSIONS, save_upload_file

DAY_ORDER = {day: idx for idx, day in enumerate(DayOfWeek)}
MEAL_ORDER = {meal: idx for idx, meal in enumerate(MealType)}


def get_cutoff_times() -> dict[str, str]:
    settings = get_settings()
    return {
        MealType.BREAKFAST.value: settings.MEAL_SKIP_CUTOFF_BREAKFAST,
        MealType.LUNCH.value: settings.MEAL_SKIP_CUTOFF_LUNCH,
        MealType.DINNER.value: settings.MEAL_SKIP_CUTOFF_DINNER,
    }


def _parse_hhmm(value: str) -> time:
    parts = value.strip().split(":")
    try:
        return time(int(parts[0]), int(parts[1]))
    except (ValueError, IndexError):
        return time(23, 59)


def _is_skip_window_open(
    skip_date: date,
    meal_type: MealType,
    *,
    now_local: datetime | None = None,
) -> tuple[bool, str | None]:
    settings = get_settings()
    current_dt = now_local or datetime.now()
    today = current_dt.date()
    if skip_date < today:
        return False, "Cannot submit or cancel a meal skip request for a past date."
    if skip_date == today and settings.MEAL_SKIP_ENFORCE_CUTOFF:
        cutoffs = get_cutoff_times()
        cutoff_str = cutoffs[meal_type.value]
        cutoff_t = _parse_hhmm(cutoff_str)
        if current_dt.time() >= cutoff_t:
            return (
                False,
                f"Cutoff time ({cutoff_str}) has already passed for today's {meal_type.value}.",
            )
    return True, None


def _serialize_menu_slot(slot: FoodMenu) -> FoodMenuSlotOut:
    items = [
        FoodMenuItemOut(
            id=it.id,
            item_name=it.item_name,
            is_veg=it.is_veg,
            sort_order=it.sort_order,
        )
        for it in slot.items
    ]
    return FoodMenuSlotOut(
        id=slot.id,
        day_of_week=slot.day_of_week,
        meal_type=slot.meal_type,
        meal_name=slot.meal_name or f"{slot.day_of_week.value.title()} {slot.meal_type.value.title()}",
        description=slot.description,
        items_description=slot.items_description,
        menu_items=items,
        timing_label=slot.timing_label,
        image_url=f"/api/v1/files/food-images/{slot.id}" if slot.image_path else None,
        is_available=slot.is_available,
        is_published=slot.is_published,
        updated_at=slot.updated_at,
    )


def _ordered_menu(db: Session, pg_id: int, *, published_only: bool = False) -> list[FoodMenuSlotOut]:
    query = select(FoodMenu).where(FoodMenu.pg_id == pg_id)
    if published_only:
        query = query.where(FoodMenu.is_published.is_(True))
    slots = db.scalars(query).all()
    slots_sorted = sorted(slots, key=lambda s: (DAY_ORDER[s.day_of_week], MEAL_ORDER[s.meal_type]))
    return [_serialize_menu_slot(s) for s in slots_sorted]


def _sync_slot_items(
    db: Session,
    slot: FoodMenu,
    *,
    items_description: str | None,
    menu_items: list[FoodMenuItemIn] | None,
) -> None:
    if menu_items is not None:
        cleaned = [
            (item.item_name.strip(), item.is_veg)
            for item in menu_items
            if item.item_name.strip()
        ]
        if not cleaned:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="At least one menu item is required.",
            )
        slot.items_description = ", ".join(name for name, _ in cleaned)
    elif items_description is not None:
        raw_desc = items_description.strip()
        if len(raw_desc) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Menu items description must be at least 2 characters.",
            )
        slot.items_description = raw_desc
        cleaned = [(part.strip()[:120], True) for part in raw_desc.split(",") if part.strip()]
    else:
        return

    slot.items.clear()
    db.flush()
    for idx, (name, is_veg) in enumerate(cleaned):
        slot.items.append(
            FoodMenuItem(
                item_name=name[:120],
                is_veg=is_veg,
                sort_order=idx,
            )
        )


def _serialize_skip(s: MealSkipRequest) -> MealSkipOut:
    allowed, _ = _is_skip_window_open(s.skip_date, s.meal_type)
    return MealSkipOut(
        id=s.id,
        skip_date=s.skip_date,
        meal_type=s.meal_type,
        status=s.status,
        reason=s.reason,
        can_cancel=(s.status == "active" and allowed),
        cancelled_at=s.cancelled_at,
        created_at=s.created_at,
    )


def get_tenant_food_overview(db: Session, tenant: Tenant) -> TenantFoodOverviewOut:
    pg = db.get(PGProperty, tenant.pg_id)
    timings = {
        "breakfast": pg.breakfast_timing if pg else "7:30 AM - 9:30 AM",
        "lunch": pg.lunch_timing if pg else "12:30 PM - 2:30 PM",
        "dinner": pg.dinner_timing if pg else "8:00 PM - 10:00 PM",
    }
    skips = db.scalars(
        select(MealSkipRequest)
        .where(MealSkipRequest.tenant_id == tenant.id)
        .order_by(MealSkipRequest.skip_date.desc(), MealSkipRequest.id.desc())
    ).all()
    ratings = db.scalars(
        select(MealRating)
        .where(MealRating.tenant_id == tenant.id)
        .order_by(MealRating.meal_date.desc(), MealRating.id.desc())
    ).all()

    return TenantFoodOverviewOut(
        weekly_menu=_ordered_menu(db, tenant.pg_id, published_only=True),
        my_skips=[_serialize_skip(s) for s in skips],
        my_ratings=[
            MealRatingOut(
                id=r.id,
                meal_date=r.meal_date,
                meal_type=r.meal_type,
                rating=r.rating,
                comment=r.comment,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
            for r in ratings
        ],
        meal_timings=timings,
        cutoff_times=get_cutoff_times(),
    )


def create_meal_skip(db: Session, tenant: Tenant, body: MealSkipCreateIn) -> MealSkipOut:
    allowed, msg = _is_skip_window_open(body.skip_date, body.meal_type)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    existing = db.scalar(
        select(MealSkipRequest).where(
            MealSkipRequest.tenant_id == tenant.id,
            MealSkipRequest.skip_date == body.skip_date,
            MealSkipRequest.meal_type == body.meal_type,
        )
    )
    if existing is not None:
        if existing.status == "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate request: you already have an active skip for this meal and date.",
            )
        existing.status = "active"
        existing.cancelled_at = None
        existing.reason = body.reason.strip() if body.reason else None
        db.commit()
        db.refresh(existing)
        row = existing
    else:
        row = MealSkipRequest(
            tenant_id=tenant.id,
            pg_id=tenant.pg_id,
            skip_date=body.skip_date,
            meal_type=body.meal_type,
            status="active",
            reason=body.reason.strip() if body.reason else None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    return _serialize_skip(row)


def cancel_meal_skip(db: Session, tenant: Tenant, skip_id: int) -> dict[str, str]:
    row = db.get(MealSkipRequest, skip_id)
    if row is None or row.tenant_id != tenant.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal skip request not found.")
    if row.status == "cancelled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Meal skip is already cancelled.")

    allowed, msg = _is_skip_window_open(row.skip_date, row.meal_type)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    row.status = "cancelled"
    row.cancelled_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Meal skip cancelled."}


def upsert_meal_rating(db: Session, tenant: Tenant, body: MealRatingCreateIn) -> MealRatingOut:
    if body.meal_date > date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot rate a meal scheduled in the future.",
        )

    existing = db.scalar(
        select(MealRating).where(
            MealRating.tenant_id == tenant.id,
            MealRating.meal_date == body.meal_date,
            MealRating.meal_type == body.meal_type,
        )
    )
    if existing is not None:
        existing.rating = body.rating
        existing.comment = body.comment.strip() if body.comment else None
        existing.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        row = existing
    else:
        row = MealRating(
            tenant_id=tenant.id,
            pg_id=tenant.pg_id,
            meal_date=body.meal_date,
            meal_type=body.meal_type,
            rating=body.rating,
            comment=body.comment.strip() if body.comment else None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    return MealRatingOut(
        id=row.id,
        meal_date=row.meal_date,
        meal_type=row.meal_type,
        rating=row.rating,
        comment=row.comment,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def get_manager_food_overview(
    db: Session,
    *,
    pg_id: int,
    target_date: date | None = None,
) -> ManagerFoodOverviewOut:
    day = target_date or date.today()
    skips = db.scalars(
        select(MealSkipRequest)
        .where(
            MealSkipRequest.pg_id == pg_id,
            MealSkipRequest.skip_date == day,
        )
        .order_by(MealSkipRequest.created_at.desc(), MealSkipRequest.id.desc())
    ).all()

    skip_counts = {m.value: 0 for m in MealType}
    skip_details = []
    for s in skips:
        if s.status == "active":
            skip_counts[s.meal_type.value] += 1
        tenant = db.get(Tenant, s.tenant_id)
        room = db.get(Room, tenant.room_id) if tenant else None
        bed = db.get(Bed, tenant.bed_id) if tenant else None
        skip_details.append(
            {
                "id": s.id,
                "tenant_name": tenant.full_name if tenant else "Tenant",
                "room_number": room.room_number if room else "-",
                "bed_code": bed.bed_code if bed else "-",
                "skip_date": s.skip_date.isoformat(),
                "meal_type": s.meal_type.value,
                "status": s.status,
                "reason": s.reason,
                "created_at": s.created_at.isoformat(),
            }
        )

    ratings = db.scalars(
        select(MealRating)
        .where(MealRating.pg_id == pg_id)
        .order_by(MealRating.meal_date.desc(), MealRating.id.desc())
        .limit(50)
    ).all()

    avg_ratings: dict[str, float | None] = {}
    rating_counts: dict[str, int] = {}
    for meal in MealType:
        vals = [r.rating for r in ratings if r.meal_type == meal]
        rating_counts[meal.value] = len(vals)
        avg_ratings[meal.value] = round(sum(vals) / len(vals), 2) if vals else None

    recent_ratings = []
    for r in ratings[:25]:
        tenant = db.get(Tenant, r.tenant_id)
        room = db.get(Room, tenant.room_id) if tenant else None
        recent_ratings.append(
            {
                "id": r.id,
                "tenant_name": tenant.full_name if tenant else "Resident",
                "room_number": room.room_number if room else "-",
                "meal_date": r.meal_date.isoformat(),
                "meal_type": r.meal_type.value,
                "rating": r.rating,
                "comment": r.comment,
            }
        )

    weekly_menu = _ordered_menu(db, pg_id, published_only=False)
    is_menu_published = bool(weekly_menu) and any(s.is_published for s in weekly_menu)

    return ManagerFoodOverviewOut(
        target_date=day,
        is_menu_published=is_menu_published,
        cutoff_times=get_cutoff_times(),
        weekly_menu=weekly_menu,
        skip_counts=skip_counts,
        skip_details=skip_details,
        average_ratings=avg_ratings,
        rating_counts=rating_counts,
        recent_ratings=recent_ratings,
    )


def bulk_update_food_menu(
    db: Session,
    *,
    pg_id: int,
    manager_user: User,
    body: FoodMenuBulkUpdateIn,
) -> list[FoodMenuSlotOut]:
    for slot in body.slots:
        existing = db.scalar(
            select(FoodMenu).where(
                FoodMenu.pg_id == pg_id,
                FoodMenu.day_of_week == slot.day_of_week,
                FoodMenu.meal_type == slot.meal_type,
            )
        )
        default_name = f"{slot.day_of_week.value.title()} {slot.meal_type.value.title()}"
        if existing is not None:
            existing.meal_name = (slot.meal_name or existing.meal_name or default_name).strip()
            existing.description = slot.description.strip() if slot.description is not None else existing.description
            existing.timing_label = slot.timing_label.strip()
            existing.is_available = slot.is_available
            existing.is_published = slot.is_published
            existing.updated_by = manager_user.id
            _sync_slot_items(
                db,
                existing,
                items_description=slot.items_description,
                menu_items=slot.menu_items,
            )
        else:
            row = FoodMenu(
                pg_id=pg_id,
                day_of_week=slot.day_of_week,
                meal_type=slot.meal_type,
                meal_name=(slot.meal_name or default_name).strip(),
                description=slot.description.strip() if slot.description else None,
                items_description=(slot.items_description or "").strip(),
                timing_label=slot.timing_label.strip(),
                is_available=slot.is_available,
                is_published=slot.is_published,
                updated_by=manager_user.id,
            )
            db.add(row)
            db.flush()
            _sync_slot_items(
                db,
                row,
                items_description=slot.items_description,
                menu_items=slot.menu_items,
            )
    db.commit()
    return _ordered_menu(db, pg_id, published_only=False)


def patch_food_menu_slot(
    db: Session,
    *,
    pg_id: int,
    menu_id: int,
    manager_user: User,
    body: FoodMenuSlotPatchIn,
) -> FoodMenuSlotOut:
    slot = db.get(FoodMenu, menu_id)
    if slot is None or slot.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food menu slot not found.")

    if body.meal_name is not None:
        slot.meal_name = body.meal_name.strip()
    if body.description is not None:
        slot.description = body.description.strip() or None
    if body.timing_label is not None:
        slot.timing_label = body.timing_label.strip()
    if body.is_available is not None:
        slot.is_available = body.is_available
    if body.is_published is not None:
        slot.is_published = body.is_published
    slot.updated_by = manager_user.id

    _sync_slot_items(
        db,
        slot,
        items_description=body.items_description,
        menu_items=body.menu_items,
    )
    db.commit()
    db.refresh(slot)
    return _serialize_menu_slot(slot)


def publish_weekly_menu(
    db: Session,
    *,
    pg_id: int,
    manager_user: User,
    is_published: bool,
) -> list[FoodMenuSlotOut]:
    slots = db.scalars(select(FoodMenu).where(FoodMenu.pg_id == pg_id)).all()
    if not slots:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configure at least one meal slot before publishing the weekly menu.",
        )
    for slot in slots:
        slot.is_published = is_published
        slot.updated_by = manager_user.id
    db.commit()
    return _ordered_menu(db, pg_id, published_only=False)


async def upload_food_menu_image(
    db: Session,
    *,
    pg_id: int,
    menu_id: int,
    manager_user: User,
    file: UploadFile,
) -> FoodMenuSlotOut:
    slot = db.get(FoodMenu, menu_id)
    if slot is None or slot.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food menu slot not found.")

    _orig_name, rel_path, _mime = await save_upload_file(
        file,
        subfolder=f"food_menus/{slot.id}",
        allowed_extensions=ALLOWED_IMAGE_EXTENSIONS,
    )
    slot.image_path = rel_path
    slot.updated_by = manager_user.id
    db.commit()
    db.refresh(slot)
    return _serialize_menu_slot(slot)
