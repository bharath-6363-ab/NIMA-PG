from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.config import get_settings


def utcnow() -> datetime:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Base SQLAlchemy declarative class for all ORM models."""


class TimestampMixin:
    """Reusable created_at / updated_at columns compatible with SQLite and PostgreSQL."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


settings = get_settings()

is_sqlite = settings.DATABASE_URL.startswith("sqlite")
engine_kwargs: dict = {"pool_pre_ping": True}
if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, **engine_kwargs)

if is_sqlite:
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=Session)


def get_db() -> Generator[Session, None, None]:
    """Yield a database session per request and ensure cleanup."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_auth_schema_columns() -> None:
    """Safely add additive columns for existing SQLite/dev databases without resetting data."""
    inspector = inspect(engine)
    if inspector.has_table("otp_sessions"):
        cols = {col["name"] for col in inspector.get_columns("otp_sessions")}
        if "purpose" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE otp_sessions ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'login'"
                    )
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS ix_otp_sessions_purpose ON otp_sessions (purpose)")
                )


def init_db() -> None:
    """Initialize SQLAlchemy metadata tables if not already created."""
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_auth_schema_columns()

