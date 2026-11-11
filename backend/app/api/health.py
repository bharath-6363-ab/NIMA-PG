from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db

router = APIRouter(tags=["Health"])


@router.get("/health")
def api_health_check(db: Session = Depends(get_db)) -> dict[str, str]:
    """Verify FastAPI service health and active database connectivity."""
    settings = get_settings()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connectivity check failed.",
        ) from exc

    return {
        "status": "ok",
        "database": "connected",
        "environment": settings.ENVIRONMENT,
        "service": settings.APP_NAME,
    }

