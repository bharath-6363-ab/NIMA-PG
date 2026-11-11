from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, utcnow
from app.models.enums import DayOfWeek, MealType


class FoodMenu(Base):
    """Weekly Monday-Sunday food menu configured per PG and meal slot."""

    __tablename__ = "food_menus"
    __table_args__ = (
        UniqueConstraint("pg_id", "day_of_week", "meal_type", name="uq_pg_day_meal"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    day_of_week: Mapped[DayOfWeek] = mapped_column(
        SAEnum(DayOfWeek, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    meal_type: Mapped[MealType] = mapped_column(
        SAEnum(MealType, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    meal_name: Mapped[str] = mapped_column(String(160), default="", server_default="", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    items_description: Mapped[str] = mapped_column(Text, nullable=False)
    timing_label: Mapped[str] = mapped_column(String(60), nullable=False)
    image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    items: Mapped[list["FoodMenuItem"]] = relationship(
        "FoodMenuItem",
        back_populates="menu",
        cascade="all, delete-orphan",
        order_by="FoodMenuItem.sort_order.asc()",
    )


class FoodMenuItem(Base):
    """Individual dish/item within a PG's meal slot."""

    __tablename__ = "food_menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    food_menu_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("food_menus.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_veg: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    menu: Mapped["FoodMenu"] = relationship("FoodMenu", back_populates="items")


class MealSkipRequest(Base):
    """Tenant meal opt-out request for a specific date and meal slot."""

    __tablename__ = "meal_skip_requests"
    __table_args__ = (
        UniqueConstraint("tenant_id", "skip_date", "meal_type", name="uq_tenant_skip_meal"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    skip_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    meal_type: Mapped[MealType] = mapped_column(
        SAEnum(MealType, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=True)


class MealRating(Base):
    """Tenant meal feedback and 1-5 rating."""

    __tablename__ = "meal_ratings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "meal_date", "meal_type", name="uq_tenant_meal_rating"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    meal_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    meal_type: Mapped[MealType] = mapped_column(
        SAEnum(MealType, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=True)
