from collections.abc import Callable
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.enums import TenantStatus, UserRole
from app.models.property import PGProperty
from app.models.tenant import Tenant
from app.models.user import RevokedToken, User

bearer_scheme = HTTPBearer(auto_error=False)


def ensure_utc(dt: datetime) -> datetime:
    """Normalize SQLite naive datetimes and PostgreSQL aware datetimes to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def get_current_token_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Decode JWT token and ensure it has not been revoked."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
        )

    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please login again.",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        ) from exc

    jti = payload.get("jti")
    if not jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
        )

    revoked = db.scalar(select(RevokedToken.id).where(RevokedToken.jti == jti))
    if revoked is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been logged out.",
        )
    return payload


def get_current_user(
    payload: dict = Depends(get_current_token_payload),
    db: Session = Depends(get_db),
) -> User:
    """Resolve current active User from JWT and verify authoritative DB role."""
    sub = payload.get("sub")
    if not sub or not str(sub).isdigit():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user identifier in token.",
        )

    user = db.get(User, int(sub))
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive or no longer exists.",
        )

    if payload.get("role") != user.role.value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User role changed. Please login again.",
        )
    return user


def require_roles(*allowed_roles: UserRole) -> Callable[..., User]:
    """Build a strict FastAPI RBAC dependency allowing only specified roles."""

    def _role_guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource.",
            )
        return current_user

    return _role_guard


require_owner = require_roles(UserRole.OWNER)
require_manager_or_owner = require_roles(UserRole.MANAGER, UserRole.OWNER)
require_tenant = require_roles(UserRole.TENANT)


def get_optional_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Resolve authenticated user if Bearer credentials are provided; otherwise return None."""
    if credentials is None or not credentials.credentials:
        return None
    payload = get_current_token_payload(credentials=credentials, db=db)
    return get_current_user(payload=payload, db=db)


def get_current_tenant(
    current_user: User = Depends(require_tenant),
    db: Session = Depends(get_db),
) -> Tenant:
    """Resolve the active or latest Tenant profile for the authenticated tenant user."""
    tenant = db.scalar(
        select(Tenant)
        .where(
            Tenant.user_id == current_user.id,
            Tenant.status.in_([TenantStatus.ACTIVE, TenantStatus.NOTICE_PERIOD]),
        )
        .order_by(Tenant.id.desc())
    )
    if tenant is None:
        tenant = db.scalar(
            select(Tenant)
            .where(Tenant.user_id == current_user.id)
            .order_by(Tenant.id.desc())
        )
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant profile not found for this account.",
        )
    return tenant


def user_can_access_pg(db: Session, user: User, pg_id: int) -> bool:
    """Return True if user is assigned to pg_id or owns the PG property."""
    if user.pg_id == pg_id:
        return True
    if user.role == UserRole.OWNER:
        owned = db.scalar(
            select(PGProperty.id).where(
                PGProperty.id == pg_id,
                PGProperty.owner_id == user.id,
            )
        )
        return owned is not None
    return False

