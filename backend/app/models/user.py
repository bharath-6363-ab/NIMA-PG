from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import UserRole

if TYPE_CHECKING:
    from app.models.property import PGProperty
    from app.models.tenant import Tenant


class User(Base, TimestampMixin):
    """System user supporting Owner (Malik), Manager, and Tenant roles."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("pg_properties.id", ondelete="SET NULL", use_alter=True, name="fk_users_pg_id"),
        nullable=True,
        index=True,
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mobile: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    pg_property: Mapped["PGProperty | None"] = relationship(
        "PGProperty",
        foreign_keys=[pg_id],
        back_populates="staff_and_tenants",
    )
    tenant_profiles: Mapped[list["Tenant"]] = relationship(
        "Tenant",
        foreign_keys="Tenant.user_id",
        back_populates="user",
    )


class OTPSession(Base):
    """Short-lived OTP challenge session (Development OTP mode or SMS gateway)."""

    __tablename__ = "otp_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mobile: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(
        String(32),
        default="login",
        server_default="login",
        nullable=False,
        index=True,
    )
    otp_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class RevokedToken(Base):
    """JWT token revocation list so logout immediately invalidates active tokens."""

    __tablename__ = "revoked_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

