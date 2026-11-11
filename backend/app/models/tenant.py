from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import DocumentType, PoliceVerificationStatus, TenantStatus

if TYPE_CHECKING:
    from app.models.property import Bed, Room
    from app.models.user import User


class Tenant(Base, TimestampMixin):
    """Tenant occupancy and billing profile (retains full historical record after checkout)."""

    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="RESTRICT"), nullable=False, index=True)
    room_id: Mapped[int] = mapped_column(Integer, ForeignKey("rooms.id", ondelete="RESTRICT"), nullable=False, index=True)
    bed_id: Mapped[int] = mapped_column(Integer, ForeignKey("beds.id", ondelete="RESTRICT"), nullable=False, index=True)

    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mobile: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(160), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    permanent_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    emergency_contact_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    emergency_contact_phone: Mapped[str] = mapped_column(String(20), default="", nullable=False)

    monthly_rent: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    food_charges: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    security_deposit_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)

    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_leaving_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    leaving_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    police_verification_status: Mapped[PoliceVerificationStatus] = mapped_column(
        SAEnum(PoliceVerificationStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=PoliceVerificationStatus.PENDING,
        nullable=False,
    )
    status: Mapped[TenantStatus] = mapped_column(
        SAEnum(TenantStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=TenantStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    checkout_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], back_populates="tenant_profiles")
    room: Mapped["Room"] = relationship("Room", foreign_keys=[room_id])
    bed: Mapped["Bed"] = relationship("Bed", foreign_keys=[bed_id])
    documents: Mapped[list["TenantDocument"]] = relationship(
        "TenantDocument",
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    allocation_history: Mapped[list["TenantAllocationHistory"]] = relationship(
        "TenantAllocationHistory",
        back_populates="tenant",
        cascade="all, delete-orphan",
        order_by="TenantAllocationHistory.created_at.desc()",
    )


class TenantDocument(Base):
    """Uploaded tenant KYC, photo, rental agreement, or verification documents."""

    __tablename__ = "tenant_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    doc_type: Mapped[DocumentType] = mapped_column(
        SAEnum(DocumentType, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream", nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="documents")


class TenantAllocationHistory(Base):
    """Immutable audit log of tenant room/bed allocations, notice transitions, and checkouts."""

    __tablename__ = "tenant_allocation_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    room_id: Mapped[int] = mapped_column(Integer, ForeignKey("rooms.id", ondelete="RESTRICT"), nullable=False)
    bed_id: Mapped[int] = mapped_column(Integer, ForeignKey("beds.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    monthly_rent: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    food_charges: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="allocation_history")
    room: Mapped["Room"] = relationship("Room", foreign_keys=[room_id])
    bed: Mapped["Bed"] = relationship("Bed", foreign_keys=[bed_id])
