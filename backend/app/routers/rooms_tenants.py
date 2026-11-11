from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_tenant, get_current_user, require_manager_or_owner
from app.models.enums import BedStatus, DocumentType, TenantStatus, UserRole
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    BedCreateIn,
    BedDetailOut,
    BedStatusUpdateIn,
    BedUpdateIn,
    RoomCreateIn,
    RoomDetailOut,
    RoomUpdateIn,
    TenantAllocationHistoryOut,
    TenantCheckoutIn,
    TenantCheckoutOut,
    TenantCreateIn,
    TenantCreateOut,
    TenantDocumentOut,
    TenantSummaryOut,
    TenantUpdateIn,
)
from app.services.room_bed_service import (
    create_bed,
    create_room,
    delete_bed,
    delete_room,
    get_bed_detail,
    get_room_detail,
    list_beds,
    list_rooms,
    update_bed,
    update_room,
)
from app.services.tenant_lifecycle_service import (
    checkout_tenant,
    get_tenant_detail,
    get_tenant_history,
    list_tenants,
    register_tenant,
    serialize_tenant,
    update_bed_operational_status,
    update_tenant,
    upload_tenant_document,
)

rooms_router = APIRouter(prefix="/rooms", tags=["Room Management"])
beds_router = APIRouter(prefix="/beds", tags=["Bed Management"])
tenants_router = APIRouter(prefix="/tenants", tags=["Tenant Management"])


def _require_pg_id(user: User) -> int:
    if user.pg_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No PG property assigned to this account.",
        )
    return user.pg_id


# ---------------------------------------------------------------------------
# Rooms API (/api/rooms)
# ---------------------------------------------------------------------------
@rooms_router.get("", response_model=list[RoomDetailOut])
def api_list_rooms(
    search: str | None = Query(default=None),
    availability: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[RoomDetailOut]:
    pg_id = _require_pg_id(current_user)
    return list_rooms(
        db,
        pg_id=pg_id,
        search=search,
        availability=availability,
        include_inactive=include_inactive,
    )


@rooms_router.post("", response_model=RoomDetailOut)
def api_create_room(
    body: RoomCreateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> RoomDetailOut:
    pg_id = _require_pg_id(current_user)
    return create_room(db, pg_id=pg_id, body=body)


@rooms_router.get("/{room_id}", response_model=RoomDetailOut)
def api_get_room(
    room_id: int,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> RoomDetailOut:
    pg_id = _require_pg_id(current_user)
    return get_room_detail(db, pg_id=pg_id, room_id=room_id)


@rooms_router.patch("/{room_id}", response_model=RoomDetailOut)
def api_update_room(
    room_id: int,
    body: RoomUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> RoomDetailOut:
    pg_id = _require_pg_id(current_user)
    return update_room(db, pg_id=pg_id, room_id=room_id, body=body)


@rooms_router.delete("/{room_id}")
def api_delete_room(
    room_id: int,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    pg_id = _require_pg_id(current_user)
    return delete_room(db, pg_id=pg_id, room_id=room_id)


# ---------------------------------------------------------------------------
# Beds API (/api/beds)
# ---------------------------------------------------------------------------
@beds_router.get("", response_model=list[BedDetailOut])
def api_list_beds(
    room_id: int | None = Query(default=None),
    status_filter: BedStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[BedDetailOut]:
    pg_id = _require_pg_id(current_user)
    return list_beds(
        db,
        pg_id=pg_id,
        room_id=room_id,
        status_filter=status_filter,
        search=search,
    )


@beds_router.post("", response_model=BedDetailOut)
def api_create_bed(
    body: BedCreateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> BedDetailOut:
    pg_id = _require_pg_id(current_user)
    return create_bed(db, pg_id=pg_id, body=body)


@beds_router.get("/{bed_id}", response_model=BedDetailOut)
def api_get_bed(
    bed_id: int,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> BedDetailOut:
    pg_id = _require_pg_id(current_user)
    return get_bed_detail(db, pg_id=pg_id, bed_id=bed_id)


@beds_router.patch("/{bed_id}", response_model=BedDetailOut)
def api_update_bed(
    bed_id: int,
    body: BedUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> BedDetailOut:
    pg_id = _require_pg_id(current_user)
    return update_bed(db, pg_id=pg_id, bed_id=bed_id, body=body)


@beds_router.patch("/{bed_id}/status")
def api_update_bed_status(
    bed_id: int,
    body: BedStatusUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> dict:
    pg_id = _require_pg_id(current_user)
    return update_bed_operational_status(
        db, pg_id=pg_id, bed_id=bed_id, new_status=body.status
    )


@beds_router.delete("/{bed_id}")
def api_delete_bed(
    bed_id: int,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    pg_id = _require_pg_id(current_user)
    return delete_bed(db, pg_id=pg_id, bed_id=bed_id)


# ---------------------------------------------------------------------------
# Tenants API (/api/tenants)
# ---------------------------------------------------------------------------
@tenants_router.get("/me", response_model=TenantSummaryOut)
def api_get_my_tenant_profile(
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> TenantSummaryOut:
    """Return strictly the authenticated tenant's own profile, allocation, deposit & history."""
    return serialize_tenant(db, tenant)


@tenants_router.get("", response_model=list[TenantSummaryOut])
def api_list_tenants(
    status_filter: TenantStatus | None = Query(default=None, alias="status"),
    room_number: str | None = Query(default=None),
    search: str | None = Query(default=None),
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> list[TenantSummaryOut]:
    pg_id = _require_pg_id(current_user)
    return list_tenants(
        db,
        pg_id=pg_id,
        status_filter=status_filter,
        room_number=room_number,
        search=search,
    )


@tenants_router.post("", response_model=TenantCreateOut)
def api_register_tenant(
    body: TenantCreateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantCreateOut:
    pg_id = _require_pg_id(current_user)
    return register_tenant(db, pg_id=pg_id, actor_user=current_user, body=body)


@tenants_router.get("/{tenant_id}", response_model=TenantSummaryOut)
def api_get_tenant(
    tenant_id: int,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantSummaryOut:
    pg_id = _require_pg_id(current_user)
    return get_tenant_detail(db, pg_id=pg_id, tenant_id=tenant_id)


@tenants_router.patch("/{tenant_id}", response_model=TenantSummaryOut)
def api_update_tenant(
    tenant_id: int,
    body: TenantUpdateIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantSummaryOut:
    pg_id = _require_pg_id(current_user)
    return update_tenant(
        db,
        pg_id=pg_id,
        tenant_id=tenant_id,
        body=body,
        actor_user_id=current_user.id,
    )


@tenants_router.post("/{tenant_id}/documents", response_model=TenantDocumentOut)
async def api_upload_tenant_document(
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


@tenants_router.get("/{tenant_id}/documents", response_model=list[TenantDocumentOut])
def api_list_tenant_documents(
    tenant_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TenantDocumentOut]:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    if current_user.role == UserRole.TENANT:
        if tenant.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied.")
    elif current_user.pg_id != tenant.pg_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    return serialize_tenant(db, tenant).documents


@tenants_router.post("/{tenant_id}/checkout", response_model=TenantCheckoutOut)
def api_checkout_tenant(
    tenant_id: int,
    body: TenantCheckoutIn,
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> TenantCheckoutOut:
    pg_id = _require_pg_id(current_user)
    return checkout_tenant(
        db,
        pg_id=pg_id,
        tenant_id=tenant_id,
        body=body,
        actor_user_id=current_user.id,
    )


@tenants_router.get("/{tenant_id}/history", response_model=list[TenantAllocationHistoryOut])
def api_get_tenant_history(
    tenant_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TenantAllocationHistoryOut]:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    if current_user.role == UserRole.TENANT:
        if tenant.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied.")
    elif current_user.pg_id != tenant.pg_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    return get_tenant_history(db, pg_id=tenant.pg_id, tenant_id=tenant_id)

