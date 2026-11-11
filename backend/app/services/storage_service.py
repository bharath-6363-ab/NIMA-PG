import os
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_DOC_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}


async def save_upload_file(
    upload: UploadFile,
    *,
    subfolder: str,
    allowed_extensions: set[str],
) -> tuple[str, str, str]:
    """Validate and persist an uploaded file safely using a UUID filename.

    Returns (original_filename, relative_path, mime_type).
    """
    settings = get_settings()
    original_name = Path(upload.filename or "upload").name
    ext = Path(original_name).suffix.lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unsupported file extension '{ext}'. Allowed: {sorted(allowed_extensions)}",
        )

    content = await upload.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Uploaded file is empty.",
        )
    if len(content) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    safe_name = f"{uuid.uuid4().hex}{ext}"
    root = Path(settings.UPLOAD_DIR).resolve()
    target_dir = (root / subfolder).resolve()
    if not str(target_dir).startswith(str(root)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload path.")

    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name
    target_path.write_bytes(content)

    rel_path = os.path.join(subfolder, safe_name).replace("\\", "/")
    mime_type = upload.content_type or "application/octet-stream"
    return original_name, rel_path, mime_type


def resolve_upload_path(relative_path: str) -> Path:
    """Resolve a stored relative upload path safely within UPLOAD_DIR."""
    settings = get_settings()
    root = Path(settings.UPLOAD_DIR).resolve()
    resolved = (root / relative_path).resolve()
    if not str(resolved).startswith(str(root)) or not resolved.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded file not found.")
    return resolved

