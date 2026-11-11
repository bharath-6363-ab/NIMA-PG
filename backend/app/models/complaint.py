from datetime import datetime

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import ComplaintCategory, ComplaintStatus


class Complaint(Base, TimestampMixin):
    """Tenant maintenance complaint with 4-stage lifecycle tracking."""

    __tablename__ = "complaints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="CASCADE"), nullable=False, index=True)
    room_id: Mapped[int] = mapped_column(Integer, ForeignKey("rooms.id", ondelete="RESTRICT"), nullable=False, index=True)
    bed_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("beds.id", ondelete="SET NULL"), nullable=True, index=True)
    room_number_snapshot: Mapped[str | None] = mapped_column(String(30), nullable=True)
    bed_code_snapshot: Mapped[str | None] = mapped_column(String(50), nullable=True)

    category: Mapped[ComplaintCategory] = mapped_column(
        SAEnum(ComplaintCategory, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[ComplaintStatus] = mapped_column(
        SAEnum(ComplaintStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=ComplaintStatus.SUBMITTED,
        nullable=False,
        index=True,
    )
    manager_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_manager_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    in_progress_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    tenant_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tenant_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)

    images: Mapped[list["ComplaintImage"]] = relationship(
        "ComplaintImage",
        back_populates="complaint",
        cascade="all, delete-orphan",
    )
    history: Mapped[list["ComplaintHistory"]] = relationship(
        "ComplaintHistory",
        back_populates="complaint",
        cascade="all, delete-orphan",
        order_by="ComplaintHistory.changed_at.asc()",
    )


class ComplaintImage(Base):
    """Photo attachment for a tenant complaint."""

    __tablename__ = "complaint_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    complaint_id: Mapped[int] = mapped_column(Integer, ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), default="image/jpeg", nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    complaint: Mapped["Complaint"] = relationship("Complaint", back_populates="images")


class ComplaintHistory(Base):
    """Audit trail of complaint status transitions and manager remarks."""

    __tablename__ = "complaint_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    complaint_id: Mapped[int] = mapped_column(Integer, ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True)
    old_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    new_status: Mapped[str] = mapped_column(String(40), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    complaint: Mapped["Complaint"] = relationship("Complaint", back_populates="history")


ComplaintStatusHistory = ComplaintHistory


