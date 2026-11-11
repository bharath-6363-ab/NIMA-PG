from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import user_can_access_pg

from app.models.complaint import Complaint, ComplaintHistory, ComplaintImage
from app.models.enums import ComplaintCategory, ComplaintStatus, NotificationType, UserRole
from app.models.notification import Notification
from app.models.property import Bed, Room
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.domain import (
    ComplaintHistoryOut,
    ComplaintImageOut,
    ComplaintOut,
    ComplaintRateIn,
    ComplaintStatusUpdateIn,
    ManagerComplaintSummaryOut,
    TenantComplaintSummaryOut,
)
from app.services.storage_service import ALLOWED_IMAGE_EXTENSIONS, save_upload_file


def serialize_complaint(db: Session, complaint: Complaint) -> ComplaintOut:
    tenant = db.get(Tenant, complaint.tenant_id)
    room = db.get(Room, complaint.room_id)
    bed = db.get(Bed, complaint.bed_id) if complaint.bed_id else (db.get(Bed, tenant.bed_id) if tenant else None)
    assigned_user = db.get(User, complaint.assigned_manager_id) if complaint.assigned_manager_id else None

    history_rows = []
    for h in complaint.history:
        actor = db.get(User, h.changed_by) if h.changed_by else None
        history_rows.append(
            ComplaintHistoryOut(
                id=h.id,
                old_status=h.old_status,
                new_status=h.new_status,
                remarks=h.remarks,
                changed_by_name=actor.full_name if actor else None,
                changed_at=h.changed_at,
            )
        )

    return ComplaintOut(
        id=complaint.id,
        tenant_id=complaint.tenant_id,
        pg_id=complaint.pg_id,
        bed_id=complaint.bed_id or (bed.id if bed else None),
        tenant_name=tenant.full_name if tenant else "Tenant",
        room_number=complaint.room_number_snapshot or (room.room_number if room else "-"),
        bed_code=complaint.bed_code_snapshot or (bed.bed_code if bed else "-"),
        category=complaint.category,
        title=complaint.title,
        description=complaint.description,
        status=complaint.status,
        manager_remarks=complaint.manager_remarks,
        assigned_manager_name=assigned_user.full_name if assigned_user else None,
        submitted_at=complaint.submitted_at,
        viewed_at=complaint.viewed_at,
        in_progress_at=complaint.in_progress_at,
        resolved_at=complaint.resolved_at,
        tenant_rating=complaint.tenant_rating,
        tenant_feedback=complaint.tenant_feedback,
        images=[
            ComplaintImageOut(
                id=img.id,
                file_name=img.file_name,
                mime_type=img.mime_type,
                url=f"/api/v1/files/complaint-images/{img.id}",
            )
            for img in complaint.images
        ],
        history=history_rows,
    )


async def create_tenant_complaint(
    db: Session,
    *,
    tenant: Tenant,
    category: ComplaintCategory,
    title: str,
    description: str,
    image: UploadFile | None = None,
) -> ComplaintOut:
    clean_title = title.strip()
    clean_desc = description.strip()
    if len(clean_title) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Complaint title must be at least 3 characters.",
        )
    if len(clean_desc) < 5:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Complaint description must be at least 5 characters.",
        )

    now = datetime.now(timezone.utc)
    room = db.get(Room, tenant.room_id)
    bed = db.get(Bed, tenant.bed_id)
    room_label = room.room_number if room else str(tenant.room_id)
    bed_label = bed.bed_code if bed else str(tenant.bed_id)

    complaint = Complaint(
        tenant_id=tenant.id,
        pg_id=tenant.pg_id,
        room_id=tenant.room_id,
        bed_id=tenant.bed_id,
        room_number_snapshot=room_label,
        bed_code_snapshot=bed_label,
        category=category,
        title=clean_title,
        description=clean_desc,
        status=ComplaintStatus.SUBMITTED,
        submitted_at=now,
    )
    db.add(complaint)
    db.flush()

    db.add(
        ComplaintHistory(
            complaint_id=complaint.id,
            old_status=None,
            new_status=ComplaintStatus.SUBMITTED.value,
            remarks="Complaint submitted by tenant.",
            changed_by=tenant.user_id,
            changed_at=now,
        )
    )

    if image is not None and image.filename:
        orig_name, rel_path, mime = await save_upload_file(
            image,
            subfolder=f"complaints/{complaint.id}",
            allowed_extensions=ALLOWED_IMAGE_EXTENSIONS,
        )
        db.add(
            ComplaintImage(
                complaint_id=complaint.id,
                file_name=orig_name,
                file_path=rel_path,
                mime_type=mime,
                uploaded_at=now,
            )
        )

    managers = db.scalars(
        select(User).where(
            User.pg_id == tenant.pg_id,
            User.role.in_([UserRole.MANAGER, UserRole.OWNER]),
            User.is_active.is_(True),
        )
    ).all()
    for mgr in managers:
        db.add(
            Notification(
                user_id=mgr.id,
                pg_id=tenant.pg_id,
                notif_type=NotificationType.COMPLAINT_UPDATE,
                title=f"New Complaint - Room {room_label}",
                message=f"{tenant.full_name} ({bed_label}): {complaint.title}",
            )
        )

    db.commit()
    db.refresh(complaint)
    return serialize_complaint(db, complaint)


def list_tenant_complaints(db: Session, tenant: Tenant) -> list[ComplaintOut]:
    rows = db.scalars(
        select(Complaint)
        .where(Complaint.tenant_id == tenant.id)
        .order_by(Complaint.submitted_at.desc(), Complaint.id.desc())
    ).all()
    return [serialize_complaint(db, c) for c in rows]


def get_tenant_complaint_summary(db: Session, tenant: Tenant) -> TenantComplaintSummaryOut:
    items = list_tenant_complaints(db, tenant)
    open_count = sum(
        1 for c in items if c.status in (ComplaintStatus.SUBMITTED, ComplaintStatus.VIEWED_BY_MANAGER)
    )
    in_progress_count = sum(1 for c in items if c.status == ComplaintStatus.IN_PROGRESS)
    resolved_count = sum(1 for c in items if c.status == ComplaintStatus.RESOLVED)
    return TenantComplaintSummaryOut(
        total_count=len(items),
        open_count=open_count,
        in_progress_count=in_progress_count,
        resolved_count=resolved_count,
        complaints=items,
    )


def get_complaint_detail_for_user(
    db: Session,
    *,
    current_user: User,
    complaint_id: int,
) -> ComplaintOut:
    complaint = db.get(Complaint, complaint_id)
    if complaint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found.")

    if current_user.role == UserRole.TENANT:
        tenant = db.get(Tenant, complaint.tenant_id)
        if tenant is None or tenant.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    elif not user_can_access_pg(db, current_user, complaint.pg_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    return serialize_complaint(db, complaint)


def rate_resolved_complaint(
    db: Session,
    *,
    tenant: Tenant,
    complaint_id: int,
    body: ComplaintRateIn,
) -> ComplaintOut:
    complaint = db.get(Complaint, complaint_id)
    if complaint is None or complaint.tenant_id != tenant.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found.")
    if complaint.status != ComplaintStatus.RESOLVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only resolved complaints can be rated.",
        )

    complaint.tenant_rating = body.rating
    complaint.tenant_feedback = body.feedback.strip() if body.feedback else None
    db.commit()
    db.refresh(complaint)
    return serialize_complaint(db, complaint)


def list_manager_complaints(
    db: Session,
    *,
    pg_id: int,
    status_group: str | None = None,
    status_filter: ComplaintStatus | None = None,
    category: ComplaintCategory | None = None,
    search: str | None = None,
    sort_order: str = "desc",
) -> ManagerComplaintSummaryOut:
    order_clause = (
        (Complaint.submitted_at.asc(), Complaint.id.asc())
        if sort_order == "asc"
        else (Complaint.submitted_at.desc(), Complaint.id.desc())
    )
    all_rows = db.scalars(
        select(Complaint)
        .where(Complaint.pg_id == pg_id)
        .order_by(*order_clause)
    ).all()

    submitted_count = sum(1 for c in all_rows if c.status == ComplaintStatus.SUBMITTED)
    viewed_count = sum(1 for c in all_rows if c.status == ComplaintStatus.VIEWED_BY_MANAGER)
    new_count = submitted_count + viewed_count
    in_progress_count = sum(1 for c in all_rows if c.status == ComplaintStatus.IN_PROGRESS)
    resolved_count = sum(1 for c in all_rows if c.status == ComplaintStatus.RESOLVED)

    filtered = []
    search_lower = search.strip().lower() if search else None
    for c in all_rows:
        if status_filter is not None and c.status != status_filter:
            continue
        if status_group:
            g = status_group.strip().lower()
            if g == "new" and c.status not in (ComplaintStatus.SUBMITTED, ComplaintStatus.VIEWED_BY_MANAGER):
                continue
            elif g == "in_progress" and c.status != ComplaintStatus.IN_PROGRESS:
                continue
            elif g == "resolved" and c.status != ComplaintStatus.RESOLVED:
                continue
            elif g in {s.value for s in ComplaintStatus} and c.status.value != g:
                continue
        if category is not None and c.category != category:
            continue

        serialized = serialize_complaint(db, c)
        if search_lower:
            haystack = f"{serialized.room_number} {serialized.bed_code} {serialized.tenant_name} {serialized.title}".lower()
            if search_lower not in haystack:
                continue
        filtered.append(serialized)

    return ManagerComplaintSummaryOut(
        total_count=len(all_rows),
        new_count=new_count,
        viewed_count=viewed_count,
        in_progress_count=in_progress_count,
        resolved_count=resolved_count,
        complaints=filtered,
    )


def update_complaint_status(
    db: Session,
    *,
    pg_id: int,
    manager_user: User,
    complaint_id: int,
    body: ComplaintStatusUpdateIn,
) -> ComplaintOut:
    complaint = db.get(Complaint, complaint_id)
    if complaint is None or complaint.pg_id != pg_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found.")

    if body.status == ComplaintStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot revert complaint status back to submitted.",
        )

    now = datetime.now(timezone.utc)
    old_status = complaint.status.value
    new_status = body.status

    complaint.status = new_status
    complaint.assigned_manager_id = manager_user.id
    if body.remarks is not None:
        complaint.manager_remarks = body.remarks.strip() or None

    if new_status == ComplaintStatus.VIEWED_BY_MANAGER and complaint.viewed_at is None:
        complaint.viewed_at = now
    elif new_status == ComplaintStatus.IN_PROGRESS:
        if complaint.viewed_at is None:
            complaint.viewed_at = now
        if complaint.in_progress_at is None:
            complaint.in_progress_at = now
    elif new_status == ComplaintStatus.RESOLVED:
        if complaint.viewed_at is None:
            complaint.viewed_at = now
        if complaint.in_progress_at is None:
            complaint.in_progress_at = now
        complaint.resolved_at = now

    db.add(
        ComplaintHistory(
            complaint_id=complaint.id,
            old_status=old_status,
            new_status=new_status.value,
            remarks=body.remarks.strip() if body.remarks else None,
            changed_by=manager_user.id,
            changed_at=now,
        )
    )

    tenant = db.get(Tenant, complaint.tenant_id)
    if tenant is not None:
        status_label = new_status.value.replace("_", " ").title()
        db.add(
            Notification(
                user_id=tenant.user_id,
                pg_id=pg_id,
                notif_type=NotificationType.COMPLAINT_UPDATE,
                title=f"Complaint Update: {status_label}",
                message=f"'{complaint.title}' is now {status_label}."
                + (f" Remarks: {complaint.manager_remarks}" if complaint.manager_remarks else ""),
            )
        )

    db.commit()
    db.refresh(complaint)
    return serialize_complaint(db, complaint)
