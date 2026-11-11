from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, utcnow
from app.models.enums import NotificationType


class Notification(Base):
    """In-app notifications for rent reminders, payment receipts, and complaint updates."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    pg_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=True, index=True)
    notif_type: Mapped[NotificationType] = mapped_column(
        SAEnum(NotificationType, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=NotificationType.GENERAL,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

