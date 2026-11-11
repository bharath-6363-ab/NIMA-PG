from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import UserRole


class RequestOTPIn(BaseModel):
    mobile: str = Field(..., min_length=10, max_length=20)
    portal_role: UserRole | None = Field(
        default=None,
        description="Optional login tab check only; never grants or changes a user's assigned role.",
    )


class RequestOTPOut(BaseModel):
    message: str
    mobile: str
    purpose: Literal["login", "registration"] = "login"
    expires_in_seconds: int
    cooldown_seconds: int = 30
    dev_otp_mode: bool
    dev_otp: str | None = Field(
        default=None,
        description="Returned only when DEV_OTP_MODE is active in non-production environments.",
    )


class VerifyOTPIn(BaseModel):
    mobile: str = Field(..., min_length=10, max_length=20)
    otp: str = Field(..., min_length=4, max_length=8)
    portal_role: UserRole | None = None


class PasswordLoginIn(BaseModel):
    mobile: str = Field(..., min_length=10, max_length=20)
    password: str = Field(..., min_length=4, max_length=128)
    portal_role: UserRole | None = None


class UserOut(BaseModel):
    id: int
    pg_id: int | None
    full_name: str
    mobile: str
    email: str | None
    role: UserRole
    is_active: bool
    pg_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserOut


class AuthConfigOut(BaseModel):
    dev_otp_mode: bool
    sms_provider_configured: bool
    otp_expire_minutes: int = 5
    otp_resend_cooldown_seconds: int = 30
    notice: str


class PublicPGOptionOut(BaseModel):
    id: int
    name: str
    city: str
    gender_policy: str


class TenantRegisterOTPRequestIn(BaseModel):
    mobile: str = Field(..., min_length=10, max_length=20)
    role: UserRole | None = Field(
        default=None,
        description="Ignored for elevation; any non-tenant value is rejected.",
    )


class TenantSelfRegisterIn(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    mobile: str = Field(..., min_length=10, max_length=20)
    email: EmailStr | None = None
    password: str = Field(..., min_length=6, max_length=128)
    otp: str = Field(..., min_length=4, max_length=8)
    pg_id: int | None = None
    role: UserRole | None = Field(
        default=None,
        description="Optional tamper-check field; backend strictly assigns TENANT role only.",
    )

    @field_validator("email", mode="before")
    @classmethod
    def _empty_email_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class TenantSelfRegisterOut(BaseModel):
    message: str
    user: UserOut


class RegisterUserIn(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    mobile: str = Field(..., min_length=10, max_length=20)
    email: EmailStr | None = None
    password: str = Field(..., min_length=6, max_length=128)
    role: UserRole = UserRole.TENANT


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    is_active: bool | None = None
    role: UserRole | None = None


class PortalStatusOut(BaseModel):
    portal: UserRole
    user_id: int
    full_name: str
    mobile: str
    pg_id: int | None
    pg_name: str | None
    status: str = "placeholder_ready"

