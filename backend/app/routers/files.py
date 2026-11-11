from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, user_can_access_pg
from app.models.complaint import Complaint, ComplaintImage
from app.models.enums import UserRole
from app.models.food import FoodMenu
from app.models.tenant import Tenant, TenantDocument
from app.models.user import User
from app.services.storage_service import resolve_upload_path

router = APIRouter(prefix="/files", tags=["Protected Files"])


@router.get("/tenant-docs/{doc_id}")
def download_tenant_document(
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Serve tenant KYC/agreement documents strictly to authorized PG staff or the owning tenant."""
    doc = db.get(TenantDocument, doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    tenant = db.get(Tenant, doc.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    if current_user.role == UserRole.TENANT:
        if tenant.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    elif not user_can_access_pg(db, current_user, tenant.pg_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    file_path = resolve_upload_path(doc.file_path)
    return FileResponse(path=str(file_path), media_type=doc.mime_type, filename=doc.file_name)


@router.get("/complaint-images/{image_id}")
def download_complaint_image(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Serve complaint photo attachments strictly to PG staff or the submitting tenant."""
    img = db.get(ComplaintImage, image_id)
    if img is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")

    complaint = db.get(Complaint, img.complaint_id)
    if complaint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Complaint not found.")

    tenant = db.get(Tenant, complaint.tenant_id)
    if current_user.role == UserRole.TENANT:
        if tenant is None or tenant.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    elif not user_can_access_pg(db, current_user, complaint.pg_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    file_path = resolve_upload_path(img.file_path)
    return FileResponse(path=str(file_path), media_type=img.mime_type, filename=img.file_name)


@router.get("/food-images/{menu_id}")
def download_food_menu_image(
    menu_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Serve meal photos only to authenticated residents or staff within that PG."""
    slot = db.get(FoodMenu, menu_id)
    if slot is None or not slot.image_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal image not found.")
    if not user_can_access_pg(db, current_user, slot.pg_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    file_path = resolve_upload_path(slot.image_path)
    return FileResponse(path=str(file_path))

