from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_manager_or_owner, require_owner
from app.models.enums import BedStatus, PaymentMethod, RentStatus, TenantStatus, UserRole
from app.models.property import PGProperty
from app.models.user import User
from app.schemas.domain import (
    BedVacancyOut,
    BedVacancyUpdateIn,
    ManagerCreateIn,
    ManagerOut,
    ManagerUpdateIn,
    ManualPaymentIn,
    OwnerFinanceDashboardOut,
    OwnerFinancialReportsOut,
    OwnerTransactionRow,
    OwnerVacancyDashboardOut,
    PGSettingsUpdateIn,
    RoomCreateIn,
    RoomUpdateIn,
    TenantSummaryOut,
    VacancyShareLinkCreateIn,
    VacancyShareLinkOut,
)
from app.services.owner_service import (
    build_monthly_financial_report,
    create_manager,
    create_room_with_beds,
    create_share_link,
    get_financial_dashboard,
    get_financial_reports_data,
    get_owner_pg,
    get_tenant_financial_history,
    get_vacancy_dashboard,
    list_managers,
    record_manual_payment,
    remove_manager,
    revoke_share_link,
    send_rent_reminder,
    update_bed_vacancy_settings,
    update_manager,
    update_pg_settings,
    update_room,
)
from app.services.tenant_lifecycle_service import list_pg_rooms_with_beds, list_tenants

router = APIRouter(prefix="/owner", tags=["Owner (Malik)"])
vacancy_router = APIRouter(prefix="/vacancy", tags=["Vacancy Management"])


@router.get("/pg")
def get_owner_pg_settings(
    pg_id: int | None = Query(default=None),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    """Return owner-managed PG property configuration (Owner role required)."""
    pg = get_owner_pg(db, current_user, pg_id=pg_id)
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


@router.put("/pg")
def edit_owner_pg_settings(
    body: PGSettingsUpdateIn,
    pg_id: int | None = Query(default=None),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    pg = get_owner_pg(db, current_user, pg_id=pg_id)
    return update_pg_settings(db, pg=pg, body=body)


@router.get("/finance/dashboard", response_model=OwnerFinanceDashboardOut)
def get_owner_finance_dashboard(
    month: int = Query(default_factory=lambda: date.today().month, ge=1, le=12),
    year: int = Query(default_factory=lambda: date.today().year, ge=2020, le=2100),
    pg_id: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> OwnerFinanceDashboardOut:
    pg = get_owner_pg(db, current_user, pg_id=pg_id)
    return get_financial_dashboard(
        db,
        pg=pg,
        owner_user=current_user,
        month=month,
        year=year,
        search=search,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/finance/reports-data", response_model=OwnerFinancialReportsOut)
def get_owner_reports_data(
    month: int = Query(default_factory=lambda: date.today().month, ge=1, le=12),
    year: int = Query(default_factory=lambda: date.today().year, ge=2020, le=2100),
    pg_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    status_filter: RentStatus | None = Query(default=None, alias="status"),
    payment_method: PaymentMethod | None = Query(default=None),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> OwnerFinancialReportsOut:
    pg = get_owner_pg(db, current_user, pg_id=pg_id)
    return get_financial_reports_data(
        db,
        pg=pg,
        month=month,
        year=year,
        search=search,
        status_filter=status_filter,
        payment_method=payment_method,
    )


@router.get("/finance/tenants/{tenant_id}/history")
def get_tenant_finance_history(
    tenant_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    pg = get_owner_pg(db, current_user)
    return get_tenant_financial_history(db, pg=pg, tenant_id=tenant_id)


@router.post("/finance/reminders/{rent_record_id}")
def trigger_rent_reminder(
    rent_record_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    pg = get_owner_pg(db, current_user)
    return send_rent_reminder(db, pg=pg, rent_record_id=rent_record_id)


@router.post("/finance/payments/record-manual", response_model=OwnerTransactionRow)
def record_offline_verified_payment(
    body: ManualPaymentIn,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> OwnerTransactionRow:
    pg = get_owner_pg(db, current_user)
    return record_manual_payment(db, pg=pg, actor=current_user, body=body)


@router.get("/finance/report")
def download_monthly_report(
    month: int = Query(default_factory=lambda: date.today().month, ge=1, le=12),
    year: int = Query(default_factory=lambda: date.today().year, ge=2020, le=2100),
    fmt: str = Query(default="csv", pattern="^(csv|pdf)$"),
    report_type: str = Query(default="collection", pattern="^(collection|pending|overdue|payments|deposits)$"),
    pg_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Response:
    pg = get_owner_pg(db, current_user, pg_id=pg_id)
    content, media_type, filename = build_monthly_financial_report(
        db,
        pg=pg,
        month=month,
        year=year,
        fmt=fmt,
        report_type=report_type,
        search=search,
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/vacancy", response_model=OwnerVacancyDashboardOut)
def get_owner_vacancy_overview(
    pg_id: int | None = Query(default=None),
    room_id: int | None = Query(default=None),
    status_filter: BedStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    public_only: bool = Query(default=False),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> OwnerVacancyDashboardOut:
    pg = get_owner_pg(db, current_user, pg_id=pg_id)
    return get_vacancy_dashboard(
        db,
        pg=pg,
        owner_user=current_user,
        room_id=room_id,
        status_filter=status_filter,
        search=search,
        public_only=public_only,
        include_share_links=True,
    )


@router.post("/vacancy/share-links", response_model=VacancyShareLinkOut)
def generate_vacancy_share_link(
    body: VacancyShareLinkCreateIn,
    pg_id: int | None = Query(default=None),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> VacancyShareLinkOut:
    pg = get_owner_pg(db, current_user, pg_id=pg_id)
    return create_share_link(db, pg=pg, owner=current_user, body=body)


@router.delete("/vacancy/share-links/{link_id}")
def deactivate_vacancy_share_link(
    link_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    pg = get_owner_pg(db, current_user)
    return revoke_share_link(db, pg=pg, link_id=link_id)


@router.get("/tenants", response_model=list[TenantSummaryOut])
def list_all_pg_tenants(
    status_filter: TenantStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> list[TenantSummaryOut]:
    pg = get_owner_pg(db, current_user)
    return list_tenants(db, pg_id=pg.id, status_filter=status_filter, search=search)


@router.get("/rooms")
def list_owner_rooms(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> list[dict]:
    pg = get_owner_pg(db, current_user)
    return list_pg_rooms_with_beds(db, pg_id=pg.id)


@router.post("/rooms")
def create_owner_room(
    body: RoomCreateIn,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    pg = get_owner_pg(db, current_user)
    return create_room_with_beds(db, pg=pg, body=body)


@router.patch("/rooms/{room_id}")
def edit_owner_room(
    room_id: int,
    body: RoomUpdateIn,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict:
    pg = get_owner_pg(db, current_user)
    return update_room(db, pg=pg, room_id=room_id, body=body)


@router.get("/managers", response_model=list[ManagerOut])
def get_pg_managers(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> list[ManagerOut]:
    pg = get_owner_pg(db, current_user)
    return list_managers(db, pg=pg)


@router.post("/managers", response_model=ManagerOut)
def add_pg_manager(
    body: ManagerCreateIn,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> ManagerOut:
    pg = get_owner_pg(db, current_user)
    return create_manager(db, pg=pg, body=body)


@router.patch("/managers/{manager_id}", response_model=ManagerOut)
def edit_pg_manager(
    manager_id: int,
    body: ManagerUpdateIn,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> ManagerOut:
    pg = get_owner_pg(db, current_user)
    return update_manager(db, pg=pg, manager_id=manager_id, body=body)


@router.delete("/managers/{manager_id}")
def delete_pg_manager(
    manager_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    pg = get_owner_pg(db, current_user)
    return remove_manager(db, pg=pg, manager_id=manager_id)


# ---------------------------------------------------------------------------
# Manager & Owner Vacancy Operations (/api/vacancy)
# ---------------------------------------------------------------------------
@vacancy_router.get("", response_model=OwnerVacancyDashboardOut)
def api_get_vacancy_overview(
    pg_id: int | None = Query(default=None),
    room_id: int | None = Query(default=None),
    status_filter: BedStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    public_only: bool = Query(default=False),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> OwnerVacancyDashboardOut:
    if current_user.role == UserRole.OWNER:
        pg = get_owner_pg(db, current_user, pg_id=pg_id)
        return get_vacancy_dashboard(
            db,
            pg=pg,
            owner_user=current_user,
            room_id=room_id,
            status_filter=status_filter,
            search=search,
            public_only=public_only,
            include_share_links=True,
        )

    # Managers are strictly scoped to their assigned PG property only
    if current_user.pg_id is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="No PG property assigned.")
    if pg_id is not None and pg_id != current_user.pg_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Managers cannot access another PG property.")
    pg = db.get(PGProperty, current_user.pg_id)
    if pg is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="PG property not found.")
    return get_vacancy_dashboard(
        db,
        pg=pg,
        owner_user=None,
        room_id=room_id,
        status_filter=status_filter,
        search=search,
        public_only=public_only,
        include_share_links=False,
    )


@vacancy_router.patch("/beds/{bed_id}", response_model=BedVacancyOut)
def api_update_bed_vacancy(
    bed_id: int,
    body: BedVacancyUpdateIn,
    pg_id: int | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> BedVacancyOut:
    if current_user.role == UserRole.OWNER:
        pg = get_owner_pg(db, current_user, pg_id=pg_id)
        target_pg_id = pg.id
    else:
        if current_user.pg_id is None:
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail="No PG property assigned.")
        target_pg_id = current_user.pg_id
    return update_bed_vacancy_settings(
        db,
        pg_id=target_pg_id,
        bed_id=bed_id,
        new_status=body.status,
        is_publicly_available=body.is_publicly_available,
    )
