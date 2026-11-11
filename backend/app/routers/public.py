from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.domain import PublicVacancyPageOut
from app.services.owner_service import (
    get_public_vacancy_by_token,
    list_public_vacancies_directory,
)

router = APIRouter(prefix="/public", tags=["Public Vacancy"])


@router.get("/vacancies")
def list_public_vacancies(db: Session = Depends(get_db)) -> list[dict]:
    """List PGs with active shareable vacancy links (exposes zero tenant PII)."""
    return list_public_vacancies_directory(db)


@router.get("/vacancy/{token}", response_model=PublicVacancyPageOut)
def view_public_vacancy(token: str, db: Session = Depends(get_db)) -> PublicVacancyPageOut:
    """Public shareable bed vacancy endpoint (exposes zero tenant personal data)."""
    return get_public_vacancy_by_token(db, token)
