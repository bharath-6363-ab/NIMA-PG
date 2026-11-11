from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import BedStatus, GenderPolicy, SharingType, VacancyStatus

if TYPE_CHECKING:
    from app.models.user import User


class PGProperty(Base, TimestampMixin):
    """PG / Hostel property configuration owned by an Owner (Malik)."""

    __tablename__ = "pg_properties"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    address: Mapped[str] = mapped_column(Text, default="", nullable=False)
    city: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    gender_policy: Mapped[GenderPolicy] = mapped_column(
        SAEnum(GenderPolicy, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=GenderPolicy.COED,
        nullable=False,
    )
    rent_due_day: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    default_monthly_rent: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("7500.00"), nullable=False)
    default_food_charges: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1000.00"), nullable=False)
    default_security_deposit: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("15000.00"), nullable=False)
    breakfast_timing: Mapped[str] = mapped_column(String(60), default="7:30 AM - 9:30 AM", nullable=False)
    lunch_timing: Mapped[str] = mapped_column(String(60), default="12:30 PM - 2:30 PM", nullable=False)
    dinner_timing: Mapped[str] = mapped_column(String(60), default="8:00 PM - 10:00 PM", nullable=False)
    amenities: Mapped[str] = mapped_column(Text, default="WiFi, Meals, RO Water, Housekeeping", nullable=False)

    owner: Mapped["User"] = relationship("User", foreign_keys=[owner_id])
    staff_and_tenants: Mapped[list["User"]] = relationship(
        "User",
        foreign_keys="User.pg_id",
        back_populates="pg_property",
    )
    rooms: Mapped[list["Room"]] = relationship("Room", back_populates="pg_property", cascade="all, delete-orphan")


class Room(Base, TimestampMixin):
    """Room within a PG property."""

    __tablename__ = "rooms"
    __table_args__ = (UniqueConstraint("pg_id", "room_number", name="uq_pg_room_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    room_number: Mapped[str] = mapped_column(String(30), nullable=False)
    floor: Mapped[str] = mapped_column(String(30), default="1st Floor", nullable=False)
    sharing_type: Mapped[SharingType] = mapped_column(
        SAEnum(SharingType, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=SharingType.DOUBLE,
        nullable=False,
    )
    max_capacity: Mapped[int] = mapped_column(Integer, default=2, server_default="2", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_rent: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("7500.00"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    pg_property: Mapped["PGProperty"] = relationship("PGProperty", back_populates="rooms")
    beds: Mapped[list["Bed"]] = relationship("Bed", back_populates="room", cascade="all, delete-orphan")


class Bed(Base, TimestampMixin):
    """Individual bed inside a room."""

    __tablename__ = "beds"
    __table_args__ = (UniqueConstraint("room_id", "bed_label", name="uq_room_bed_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    room_id: Mapped[int] = mapped_column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    bed_label: Mapped[str] = mapped_column(String(20), nullable=False)
    bed_code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    status: Mapped[BedStatus] = mapped_column(
        SAEnum(BedStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=BedStatus.VACANT,
        nullable=False,
        index=True,
    )
    monthly_rent: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("7500.00"), nullable=False)
    food_charges: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        default=Decimal("0.00"),
        server_default="0.00",
        nullable=False,
    )
    vacant_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)
    is_publicly_available: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default="1",
        nullable=False,
    )

    room: Mapped["Room"] = relationship("Room", back_populates="beds")


class VacancyRecord(Base, TimestampMixin):
    """Tracks bed vacancy intervals and days vacant across occupancy cycles."""

    __tablename__ = "vacancy_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    bed_id: Mapped[int] = mapped_column(Integer, ForeignKey("beds.id", ondelete="CASCADE"), nullable=False, index=True)
    previous_tenant_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
    )
    vacant_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    monthly_rent_snapshot: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[VacancyStatus] = mapped_column(
        SAEnum(VacancyStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=VacancyStatus.OPEN,
        nullable=False,
        index=True,
    )


class VacancyShareLink(Base):
    """Public shareable vacancy token generated by Owner (exposes zero tenant PII)."""

    __tablename__ = "vacancy_share_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), default="Live Bed Availability", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

