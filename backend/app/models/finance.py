from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import DepositStatus, PaymentMethod, PaymentStatus, RentStatus


class RentRecord(Base, TimestampMixin):
    """Monthly rent invoice record for a tenant (Base rent + Food charges + Other authorized charges; no electricity)."""

    __tablename__ = "rent_records"
    __table_args__ = (
        UniqueConstraint("tenant_id", "billing_year", "billing_month", name="uq_tenant_billing_period"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="RESTRICT"), nullable=False, index=True)
    billing_month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    billing_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    room_number_snapshot: Mapped[str | None] = mapped_column(String(30), nullable=True)
    bed_code_snapshot: Mapped[str | None] = mapped_column(String(50), nullable=True)

    base_rent: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    food_charges: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    other_charges: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        default=Decimal("0.00"),
        server_default="0.00",
        nullable=False,
    )
    other_charges_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)

    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[RentStatus] = mapped_column(
        SAEnum(RentStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=RentStatus.PENDING,
        nullable=False,
        index=True,
    )
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="rent_record")


class Payment(Base, TimestampMixin):
    """Verified or tracked rent payment transaction record (never stores card numbers, CVV, or expiry)."""

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rent_record_id: Mapped[int] = mapped_column(Integer, ForeignKey("rent_records.id", ondelete="RESTRICT"), nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="RESTRICT"), nullable=False, index=True)

    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    payment_method: Mapped[PaymentMethod] = mapped_column(
        SAEnum(PaymentMethod, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    gateway_provider: Mapped[str] = mapped_column(String(40), default="razorpay", nullable=False)
    gateway_order_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True, index=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True, index=True)
    gateway_signature: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[PaymentStatus] = mapped_column(
        SAEnum(PaymentStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=PaymentStatus.CREATED,
        nullable=False,
        index=True,
    )
    receipt_number: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    rent_record: Mapped["RentRecord"] = relationship("RentRecord", back_populates="payments")


class SecurityDeposit(Base, TimestampMixin):
    """Security deposit ledger per tenant for hold, deductions, and checkout refund tracking."""

    __tablename__ = "security_deposits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="RESTRICT"), unique=True, nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="RESTRICT"), nullable=False, index=True)

    amount_held: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    paid_status: Mapped[DepositStatus] = mapped_column(
        SAEnum(DepositStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        default=DepositStatus.HELD,
        nullable=False,
        index=True,
    )
    deduction_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    deduction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    refund_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    refund_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    transactions: Mapped[list["SecurityDepositTransaction"]] = relationship(
        "SecurityDepositTransaction",
        back_populates="deposit",
        cascade="all, delete-orphan",
        order_by="SecurityDepositTransaction.created_at.desc()",
    )


class SecurityDepositTransaction(Base):
    """Immutable audit ledger of security deposit payments, deductions, and refunds."""

    __tablename__ = "security_deposit_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    security_deposit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("security_deposits.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    pg_id: Mapped[int] = mapped_column(Integer, ForeignKey("pg_properties.id", ondelete="RESTRICT"), nullable=False, index=True)
    transaction_type: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reference_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    recorded_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    deposit: Mapped["SecurityDeposit"] = relationship("SecurityDeposit", back_populates="transactions")
