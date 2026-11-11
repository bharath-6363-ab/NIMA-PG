from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.complaint import Complaint
from app.models.enums import BedStatus, SharingType, TenantStatus, VacancyStatus
from app.models.property import Bed, PGProperty, Room, VacancyRecord
from app.models.tenant import Tenant, TenantAllocationHistory
from app.schemas.domain import (
    BedCreateIn,
    BedDetailOut,
    BedUpdateIn,
    RoomCreateIn,
    RoomDetailOut,
    RoomUpdateIn,
)


def _default_labels_for_capacity(sharing_type: SharingType, max_capacity: int) -> list[str]:
    preset_counts = {
        SharingType.SINGLE: 1,
        SharingType.DOUBLE: 2,
        SharingType.TRIPLE: 3,
        SharingType.QUAD: 4,
        SharingType.SHARED: max_capacity,
    }
    count = max(1, min(max_capacity, preset_counts.get(sharing_type, max_capacity)))
    return [chr(65 + i) if i < 26 else f"B{i + 1}" for i in range(count)]


def _active_occupants_by_bed(db: Session, pg_id: int) -> dict[int, Tenant]:
    active = db.scalars(
        select(Tenant).where(
            Tenant.pg_id == pg_id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
    ).all()
    return {t.bed_id: t for t in active}


def serialize_bed(bed: Bed, room: Room, occupant: Tenant | None = None) -> BedDetailOut:
    return BedDetailOut(
        id=bed.id,
        room_id=bed.room_id,
        room_number=room.room_number,
        floor=room.floor,
        sharing_type=room.sharing_type,
        bed_label=bed.bed_label,
        bed_code=bed.bed_code,
        status=bed.status,
        monthly_rent=bed.monthly_rent,
        food_charges=bed.food_charges,
        vacant_since=bed.vacant_since,
        is_publicly_available=bed.is_publicly_available,
        occupant_tenant_id=occupant.id if occupant else None,
        occupant_name=occupant.full_name if occupant else None,
        created_at=bed.created_at,
        updated_at=bed.updated_at,
    )


def serialize_room(room: Room, occupant_by_bed: dict[int, Tenant]) -> RoomDetailOut:
    beds_sorted = sorted(room.beds, key=lambda b: b.bed_label)
    serialized_beds = [
        serialize_bed(b, room, occupant_by_bed.get(b.id)) for b in beds_sorted
    ]
    return RoomDetailOut(
        id=room.id,
        pg_id=room.pg_id,
        room_number=room.room_number,
        floor=room.floor,
        sharing_type=room.sharing_type,
        max_capacity=room.max_capacity,
        description=room.description,
        base_rent=room.base_rent,
        is_active=room.is_active,
        total_beds=len(serialized_beds),
        vacant_beds=sum(1 for b in serialized_beds if b.status == BedStatus.VACANT),
        occupied_beds=sum(1 for b in serialized_beds if b.status == BedStatus.OCCUPIED),
        notice_period_beds=sum(1 for b in serialized_beds if b.status == BedStatus.NOTICE_PERIOD),
        maintenance_beds=sum(1 for b in serialized_beds if b.status == BedStatus.MAINTENANCE),
        created_at=room.created_at,
        updated_at=room.updated_at,
        beds=serialized_beds,
    )


def list_rooms(
    db: Session,
    *,
    pg_id: int,
    search: str | None = None,
    availability: str | None = None,
    include_inactive: bool = False,
) -> list[RoomDetailOut]:
    query = select(Room).where(Room.pg_id == pg_id).order_by(Room.room_number.asc())
    if not include_inactive:
        query = query.where(Room.is_active.is_(True))

    rooms = db.scalars(query).all()
    occupant_map = _active_occupants_by_bed(db, pg_id)
    out = [serialize_room(r, occupant_map) for r in rooms]

    if search and search.strip():
        q = search.strip().lower()
        out = [
            r
            for r in out
            if q in r.room_number.lower()
            or q in r.floor.lower()
            or (r.description and q in r.description.lower())
        ]

    if availability:
        av = availability.strip().lower()
        if av == "vacant":
            out = [r for r in out if r.vacant_beds > 0]
        elif av == "full":
            out = [r for r in out if r.total_beds > 0 and r.vacant_beds == 0]
        elif av == "maintenance":
            out = [r for r in out if r.maintenance_beds > 0]

    return out


def get_room_detail(db: Session, *, pg_id: int, room_id: int) -> RoomDetailOut:
    room = db.get(Room, room_id)
    if room is None or room.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    occupant_map = _active_occupants_by_bed(db, pg_id)
    return serialize_room(room, occupant_map)


def create_room(db: Session, *, pg_id: int, body: RoomCreateIn) -> RoomDetailOut:
    pg = db.get(PGProperty, pg_id)
    if pg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PG property not found.")

    r_num = body.room_number.strip()
    existing = db.scalar(select(Room).where(Room.pg_id == pg_id, Room.room_number == r_num))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Room {r_num} already exists in this PG.",
        )

    labels: list[str] = []
    if body.bed_labels:
        labels = [lbl.strip().upper() for lbl in body.bed_labels if lbl.strip()]
        if len(set(labels)) != len(labels):
            raise HTTPException(status_code=422, detail="Bed labels inside a room must be unique.")
        if len(labels) > body.max_capacity:
            raise HTTPException(
                status_code=422,
                detail=f"Provided {len(labels)} beds exceeds room capacity ({body.max_capacity}).",
            )
    elif body.auto_create_beds:
        labels = _default_labels_for_capacity(body.sharing_type, body.max_capacity)

    room = Room(
        pg_id=pg_id,
        room_number=r_num,
        floor=body.floor.strip() or "1st Floor",
        sharing_type=body.sharing_type,
        max_capacity=body.max_capacity,
        description=body.description.strip() if body.description else None,
        base_rent=body.base_rent,
        is_active=True,
    )
    db.add(room)
    db.flush()

    now = datetime.now(timezone.utc)
    food_default = body.food_charges if body.food_charges > 0 else Decimal("0.00")
    for lbl in labels:
        bed = Bed(
            pg_id=pg_id,
            room_id=room.id,
            bed_label=lbl,
            bed_code=f"{r_num}-{lbl}",
            status=BedStatus.VACANT,
            monthly_rent=body.base_rent,
            food_charges=food_default,
            vacant_since=now,
        )
        db.add(bed)
        db.flush()
        db.add(
            VacancyRecord(
                pg_id=pg_id,
                bed_id=bed.id,
                vacant_from=now,
                monthly_rent_snapshot=bed.monthly_rent,
                status=VacancyStatus.OPEN,
            )
        )

    db.commit()
    db.refresh(room)
    return serialize_room(room, {})


def update_room(db: Session, *, pg_id: int, room_id: int, body: RoomUpdateIn) -> RoomDetailOut:
    room = db.get(Room, room_id)
    if room is None or room.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    if body.room_number is not None:
        new_num = body.room_number.strip()
        if new_num != room.room_number:
            dup = db.scalar(
                select(Room).where(Room.pg_id == pg_id, Room.room_number == new_num)
            )
            if dup is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Room {new_num} already exists.",
                )
            room.room_number = new_num
            for bed in room.beds:
                bed.bed_code = f"{new_num}-{bed.bed_label}"

    if body.max_capacity is not None:
        if body.max_capacity < len(room.beds):
            raise HTTPException(
                status_code=422,
                detail=f"Cannot set capacity ({body.max_capacity}) below existing bed count ({len(room.beds)}).",
            )
        room.max_capacity = body.max_capacity

    if body.floor is not None:
        room.floor = body.floor.strip()
    if body.sharing_type is not None:
        room.sharing_type = body.sharing_type
    if body.description is not None:
        room.description = body.description.strip() or None
    if body.base_rent is not None:
        room.base_rent = body.base_rent
        for bed in room.beds:
            if bed.status == BedStatus.VACANT:
                bed.monthly_rent = body.base_rent
    if body.is_active is not None:
        if not body.is_active:
            has_active_bed = any(
                b.status in (BedStatus.OCCUPIED, BedStatus.NOTICE_PERIOD)
                for b in room.beds
            )
            if has_active_bed:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot deactivate a room with occupied or notice-period beds.",
                )
        room.is_active = body.is_active

    db.commit()
    db.refresh(room)
    occupant_map = _active_occupants_by_bed(db, pg_id)
    return serialize_room(room, occupant_map)


def delete_room(db: Session, *, pg_id: int, room_id: int) -> dict[str, str]:
    room = db.get(Room, room_id)
    if room is None or room.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    active_or_notice = any(
        b.status in (BedStatus.OCCUPIED, BedStatus.NOTICE_PERIOD) for b in room.beds
    )
    if active_or_notice:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete room while beds are occupied or in notice period.",
        )

    referenced_tenant = db.scalar(select(Tenant.id).where(Tenant.room_id == room.id))
    referenced_history = db.scalar(
        select(TenantAllocationHistory.id).where(TenantAllocationHistory.room_id == room.id)
    )
    referenced_complaint = db.scalar(
        select(Complaint.id).where(Complaint.room_id == room.id)
    )
    if referenced_tenant is not None or referenced_history is not None or referenced_complaint is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Room has historical tenant or complaint records and cannot be deleted. Deactivate it instead.",
        )

    room_num = room.room_number
    db.delete(room)
    db.commit()
    return {"message": f"Room {room_num} deleted."}


def list_beds(
    db: Session,
    *,
    pg_id: int,
    room_id: int | None = None,
    status_filter: BedStatus | None = None,
    search: str | None = None,
) -> list[BedDetailOut]:
    query = (
        select(Bed)
        .join(Room, Room.id == Bed.room_id)
        .where(Bed.pg_id == pg_id, Room.is_active.is_(True))
        .order_by(Bed.bed_code.asc())
    )
    if room_id is not None:
        query = query.where(Bed.room_id == room_id)
    if status_filter is not None:
        query = query.where(Bed.status == status_filter)

    beds = db.scalars(query).all()
    occupant_map = _active_occupants_by_bed(db, pg_id)
    out = [serialize_bed(b, b.room, occupant_map.get(b.id)) for b in beds]

    if search and search.strip():
        q = search.strip().lower()
        out = [
            b
            for b in out
            if q in b.bed_code.lower()
            or q in b.room_number.lower()
            or (b.occupant_name and q in b.occupant_name.lower())
        ]
    return out


def get_bed_detail(db: Session, *, pg_id: int, bed_id: int) -> BedDetailOut:
    bed = db.get(Bed, bed_id)
    if bed is None or bed.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bed not found.")
    occupant_map = _active_occupants_by_bed(db, pg_id)
    return serialize_bed(bed, bed.room, occupant_map.get(bed.id))


def create_bed(db: Session, *, pg_id: int, body: BedCreateIn) -> BedDetailOut:
    room = db.get(Room, body.room_id)
    if room is None or room.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    if len(room.beds) >= room.max_capacity:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Room {room.room_number} is already at maximum capacity ({room.max_capacity} beds).",
        )

    if body.status == BedStatus.OCCUPIED:
        raise HTTPException(
            status_code=400,
            detail="New beds cannot be created as occupied; register a tenant to occupy a bed.",
        )

    lbl = body.bed_label.strip().upper()
    dup = db.scalar(select(Bed).where(Bed.room_id == room.id, Bed.bed_label == lbl))
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bed '{lbl}' already exists in Room {room.room_number}.",
        )

    now = datetime.now(timezone.utc)
    bed = Bed(
        pg_id=pg_id,
        room_id=room.id,
        bed_label=lbl,
        bed_code=f"{room.room_number}-{lbl}",
        status=body.status,
        monthly_rent=body.monthly_rent,
        food_charges=body.food_charges,
        vacant_since=now if body.status == BedStatus.VACANT else None,
    )
    db.add(bed)
    db.flush()

    if bed.status == BedStatus.VACANT:
        db.add(
            VacancyRecord(
                pg_id=pg_id,
                bed_id=bed.id,
                vacant_from=now,
                monthly_rent_snapshot=bed.monthly_rent,
                status=VacancyStatus.OPEN,
            )
        )

    db.commit()
    db.refresh(bed)
    return serialize_bed(bed, room, None)


def update_bed(db: Session, *, pg_id: int, bed_id: int, body: BedUpdateIn) -> BedDetailOut:
    bed = db.get(Bed, bed_id)
    if bed is None or bed.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bed not found.")

    room = bed.room
    if body.bed_label is not None:
        new_lbl = body.bed_label.strip().upper()
        if new_lbl != bed.bed_label:
            dup = db.scalar(select(Bed).where(Bed.room_id == room.id, Bed.bed_label == new_lbl))
            if dup is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Bed '{new_lbl}' already exists in Room {room.room_number}.",
                )
            bed.bed_label = new_lbl
            bed.bed_code = f"{room.room_number}-{new_lbl}"

    if body.monthly_rent is not None:
        bed.monthly_rent = body.monthly_rent
    if body.food_charges is not None:
        bed.food_charges = body.food_charges
    if body.is_publicly_available is not None:
        bed.is_publicly_available = body.is_publicly_available

    if body.status is not None and body.status != bed.status:
        if body.status == BedStatus.OCCUPIED:
            raise HTTPException(
                status_code=400,
                detail="Assign a tenant to mark a bed as occupied.",
            )
        active_tenant = db.scalar(
            select(Tenant).where(
                Tenant.bed_id == bed.id,
                Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
            )
        )
        if active_tenant is not None and body.status in (BedStatus.VACANT, BedStatus.MAINTENANCE):
            raise HTTPException(
                status_code=409,
                detail="Cannot mark an occupied bed vacant/maintenance before tenant checkout.",
            )
        now = datetime.now(timezone.utc)
        bed.status = body.status
        if body.status == BedStatus.VACANT:
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
        elif body.status == BedStatus.MAINTENANCE:
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

    db.commit()
    db.refresh(bed)
    occupant_map = _active_occupants_by_bed(db, pg_id)
    return serialize_bed(bed, room, occupant_map.get(bed.id))


def delete_bed(db: Session, *, pg_id: int, bed_id: int) -> dict[str, str]:
    bed = db.get(Bed, bed_id)
    if bed is None or bed.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bed not found.")

    if bed.status in (BedStatus.OCCUPIED, BedStatus.NOTICE_PERIOD):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an occupied or notice-period bed.",
        )

    referenced_tenant = db.scalar(select(Tenant.id).where(Tenant.bed_id == bed.id))
    referenced_history = db.scalar(
        select(TenantAllocationHistory.id).where(TenantAllocationHistory.bed_id == bed.id)
    )
    if referenced_tenant is not None or referenced_history is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bed has historical tenant allocations and cannot be deleted. Set it to Maintenance instead.",
        )

    code = bed.bed_code
    db.delete(bed)
    db.commit()
    return {"message": f"Bed {code} deleted."}

