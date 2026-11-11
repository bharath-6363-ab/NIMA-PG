from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import (
    get_current_token_payload,
    get_current_user,
    get_optional_current_user,
    require_manager_or_owner,
    require_owner,
    require_tenant,
)
from app.models.enums import UserRole
from app.models.property import PGProperty
from app.models.user import User
from app.schemas.auth import (
    AuthConfigOut,
    PasswordLoginIn,
    PortalStatusOut,
    PublicPGOptionOut,
    RegisterUserIn,
    RequestOTPIn,
    RequestOTPOut,
    TenantRegisterOTPRequestIn,
    TenantSelfRegisterIn,
    TenantSelfRegisterOut,
    TokenOut,
    UserOut,
    UserUpdateIn,
    VerifyOTPIn,
)
from app.services.auth_service import (
    build_user_out,
    complete_tenant_registration,
    get_user_by_id_isolated,
    list_pg_users,
    list_public_pg_options,
    login_with_password,
    register_user_account,
    request_login_otp,
    request_tenant_registration_otp,
    revoke_token,
    update_user_by_owner,
    verify_login_otp,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/config", response_model=AuthConfigOut)
def get_auth_config() -> AuthConfigOut:
    """Expose authentication mode flags (explicitly indicates Development OTP mode or SMS status)."""
    settings = get_settings()
    if settings.is_dev_otp_enabled:
        notice = (
            f"Development OTP mode active: random OTPs valid for {settings.OTP_EXPIRE_MINUTES} minutes "
            "without live SMS delivery."
        )
    elif settings.sms_provider_configured:
        notice = "Production SMS OTP delivery is active."
    else:
        notice = "Production mode active, but SMS provider is not configured. Use password login."
    return AuthConfigOut(
        dev_otp_mode=settings.is_dev_otp_enabled,
        sms_provider_configured=settings.sms_provider_configured,
        otp_expire_minutes=settings.OTP_EXPIRE_MINUTES,
        otp_resend_cooldown_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
        notice=notice,
    )


@router.get("/registration-options", response_model=list[PublicPGOptionOut])
def get_registration_options(db: Session = Depends(get_db)) -> list[PublicPGOptionOut]:
    """Return active PG property options (non-PII) for public tenant registration."""
    return list_public_pg_options(db)


@router.post("/tenant-register/request-otp", response_model=RequestOTPOut)
def request_tenant_registration_otp_endpoint(
    body: TenantRegisterOTPRequestIn,
    db: Session = Depends(get_db),
) -> RequestOTPOut:
    """Request a mobile verification OTP before creating a new public tenant account."""
    return request_tenant_registration_otp(db, body=body)


@router.post("/tenant-register/verify", response_model=TenantSelfRegisterOut)
@router.post("/tenant-register/complete", response_model=TenantSelfRegisterOut)
def complete_tenant_registration_endpoint(
    body: TenantSelfRegisterIn,
    db: Session = Depends(get_db),
) -> TenantSelfRegisterOut:
    """Verify registration OTP and create a new active Tenant account (never grants Owner/Manager)."""
    return complete_tenant_registration(db, body=body)


@router.post("/register", response_model=UserOut)
def register_user(
    body: RegisterUserIn,
    current_user: User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Controlled user registration (Owner creates Manager/Tenant; Manager creates Tenant; public blocked)."""
    return register_user_account(db, current_user=current_user, body=body)


@router.post("/otp/request", response_model=RequestOTPOut)
@router.post("/request-otp", response_model=RequestOTPOut)
def request_otp(body: RequestOTPIn, db: Session = Depends(get_db)) -> RequestOTPOut:
    """Request a one-time password for an existing registered user."""
    return request_login_otp(db, raw_mobile=body.mobile, portal_role=body.portal_role)


@router.post("/otp/verify", response_model=TokenOut)
@router.post("/verify-otp", response_model=TokenOut)
def verify_otp(body: VerifyOTPIn, db: Session = Depends(get_db)) -> TokenOut:
    """Verify OTP and issue a role-scoped JWT access token."""
    return verify_login_otp(
        db,
        raw_mobile=body.mobile,
        otp_code=body.otp,
        portal_role=body.portal_role,
    )


@router.post("/login", response_model=TokenOut)
def password_login(body: PasswordLoginIn, db: Session = Depends(get_db)) -> TokenOut:
    """Authenticate using mobile number and password."""
    return login_with_password(
        db,
        raw_mobile=body.mobile,
        password=body.password,
        portal_role=body.portal_role,
    )


@router.post("/logout")
def logout(
    payload: dict = Depends(get_current_token_payload),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Revoke the current JWT token so it cannot be reused."""
    revoke_token(db, jti=str(payload["jti"]), exp_ts=int(payload["exp"]))
    return {"message": "Logged out successfully."}


@router.get("/me", response_model=UserOut)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Return the authenticated user's profile and authoritative role."""
    return build_user_out(db, current_user)


@router.get("/users", response_model=list[UserOut])
def list_users(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    """List all users in the PG (Owner access only)."""
    return list_pg_users(db, current_user=current_user)


@router.get("/users/{user_id}", response_model=UserOut)
def get_user_detail(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Fetch a single user account (restricted to self or PG Owner)."""
    return get_user_by_id_isolated(db, current_user=current_user, target_user_id=user_id)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user_account(
    user_id: int,
    body: UserUpdateIn,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> UserOut:
    """Update user status or role (Owner access only; Managers cannot change roles)."""
    return update_user_by_owner(db, current_user=current_user, target_user_id=user_id, body=body)


def _portal_status(db: Session, user: User, portal: UserRole) -> PortalStatusOut:
    pg_name = (
        db.scalar(select(PGProperty.name).where(PGProperty.id == user.pg_id))
        if user.pg_id is not None
        else None
    )
    return PortalStatusOut(
        portal=portal,
        user_id=user.id,
        full_name=user.full_name,
        mobile=user.mobile,
        pg_id=user.pg_id,
        pg_name=pg_name,
    )


@router.get("/portal/owner", response_model=PortalStatusOut)
def owner_portal_check(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> PortalStatusOut:
    """Role-verified placeholder check for Owner portal."""
    return _portal_status(db, current_user, UserRole.OWNER)


@router.get("/portal/manager", response_model=PortalStatusOut)
def manager_portal_check(
    current_user: User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db),
) -> PortalStatusOut:
    """Role-verified placeholder check for Manager portal."""
    return _portal_status(db, current_user, UserRole.MANAGER)


@router.get("/portal/tenant", response_model=PortalStatusOut)
def tenant_portal_check(
    current_user: User = Depends(require_tenant),
    db: Session = Depends(get_db),
) -> PortalStatusOut:
    """Role-verified placeholder check for Tenant portal."""
    return _portal_status(db, current_user, UserRole.TENANT)
