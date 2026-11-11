from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "Aapka PG Management System"
    ENVIRONMENT: str = "development"
    API_V1_PREFIX: str = "/api/v1"

    # SQLite by default for local dev; swap to postgresql+psycopg://... for production.
    DATABASE_URL: str = f"sqlite:///{(BASE_DIR / 'pg_management.db').as_posix()}"

    JWT_SECRET_KEY: str = "dev-only-insecure-secret-key-change-in-production-32bytes"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    BCRYPT_ROUNDS: int = 12

    # Development OTP mode: exposes OTP in API response/logs only when True and environment != production.
    DEV_OTP_MODE: bool = True
    DEV_OTP_CODE: str = ""
    OTP_EXPIRE_MINUTES: int = 5
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RESEND_COOLDOWN_SECONDS: int = 30
    OTP_RATE_LIMIT_MAX_REQUESTS: int = 5
    OTP_RATE_LIMIT_WINDOW_MINUTES: int = 15

    # Optional external SMS provider configuration (required in production when DEV_OTP_MODE=False).
    SMS_PROVIDER: str = ""
    SMS_API_KEY: str = ""
    SMS_SENDER_ID: str = ""
    SMS_WEBHOOK_URL: str = ""

    UPLOAD_DIR: str = str(BASE_DIR / "uploads")
    MAX_UPLOAD_BYTES: int = 5 * 1024 * 1024  # 5 MB

    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Optional Razorpay test-mode credentials (never store card details anywhere).
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""

    # Configurable meal skip cutoff times (HH:MM in 24-hour local server/PG time)
    MEAL_SKIP_ENFORCE_CUTOFF: bool = True
    MEAL_SKIP_CUTOFF_BREAKFAST: str = "07:00"
    MEAL_SKIP_CUTOFF_LUNCH: str = "10:30"
    MEAL_SKIP_CUTOFF_DINNER: str = "17:30"

    @property
    def is_dev_otp_enabled(self) -> bool:
        return self.DEV_OTP_MODE and self.ENVIRONMENT.lower() != "production"

    @property
    def sms_provider_configured(self) -> bool:
        return bool(self.SMS_PROVIDER.strip() and self.SMS_API_KEY.strip())

    @property
    def razorpay_configured(self) -> bool:
        return bool(self.RAZORPAY_KEY_ID.strip() and self.RAZORPAY_KEY_SECRET.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()

