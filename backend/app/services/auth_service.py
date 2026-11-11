import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import ensure_utc
from app.core.security import (
    create_access_token,
    generate_otp,
    hash_otp,
    hash_password,
    normalize_mobile,
    verify_otp_hash,
    verify_password,
)
from app.models.enums import NotificationType, UserRole
from app.models.notification import Notification
from app.models.property import PGProperty
from app.models.user import OTPSession, RevokedToken, User
from app.schemas.auth import (
    PublicPGOptionOut,
    RegisterUserIn,
    RequestOTPOut,
    TenantRegisterOTPRequestIn,
    TenantSelfRegisterIn,
    TenantSelfRegisterOut,
    TokenOut,
    UserOut,
    UserUpdateIn,
)
from app.services.sms_service import dispatch_otp_sms

logger = logging.getLogger("aapka_pg.auth")


def _normalize_or_422(raw_mobile: str) -> str:
    try:
        return normalize_mobile(raw_mobile)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def _resolve_user_for_login(
    db: Session,
    mobile: str,
    portal_role: UserRole | None,
) -> User:
    user = db.scalar(select(User).where(User.mobile == mobile))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No registered account found for this mobile number. Please register as a tenant first.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact PG Owner or Manager.",
        )
    if portal_role is not None and user.role != portal_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This mobile number is not registered as '{portal_role.value}'.",
        )
    return user


def build_user_out(db: Session, user: User) -> UserOut:
    pg_name: str | None = None
    if user.pg_id is not None:
        pg_name = db.scalar(select(PGProperty.name).where(PGProperty.id == user.pg_id))
    return UserOut(
        id=user.id,
        pg_id=user.pg_id,
        full_name=user.full_name,
        mobile=user.mobile,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        pg_name=pg_name,
        created_at=user.created_at,
    )


def _issue_token_response(db: Session, user: User) -> TokenOut:
    token, _jti, expires_at = create_access_token(
        user_id=user.id,
        role=user.role.value,
        pg_id=user.pg_id,
    )
    return TokenOut(
        access_token=token,
        expires_at=expires_at,
        user=build_user_out(db, user),
    )


def _issue_otp_session(
    db: Session,
    *,
    mobile: str,
    purpose: Literal["login", "registration"],
) -> RequestOTPOut:
    """Shared OTP generator with cooldown, window rate limiting, expiry, and dev/prod branching."""
    settings = get_settings()
    is_dev = settings.is_dev_otp_enabled

    if not is_dev and not settings.sms_provider_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "SMS OTP delivery provider is not configured. Configure SMS_PROVIDER and "
                "SMS_API_KEY (or use password login)."
            ),
        )

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=settings.OTP_RATE_LIMIT_WINDOW_MINUTES)
    recent_count = db.scalar(
        select(func.count(OTPSession.id)).where(
            OTPSession.mobile == mobile,
            OTPSession.purpose == purpose,
            OTPSession.created_at >= window_start,
        )
    ) or 0
    if recent_count >= settings.OTP_RATE_LIMIT_MAX_REQUESTS:
        retry_window_secs = settings.OTP_RATE_LIMIT_WINDOW_MINUTES * 60
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Too many OTP requests for this number. Please try again in "
                f"{settings.OTP_RATE_LIMIT_WINDOW_MINUTES} minutes."
            ),
            headers={"Retry-After": str(retry_window_secs)},
        )

    latest_active = db.scalar(
        select(OTPSession)
        .where(
            OTPSession.mobile == mobile,
            OTPSession.purpose == purpose,
            OTPSession.consumed.is_(False),
        )
        .order_by(OTPSession.id.desc())
    )
    if latest_active is not None and settings.OTP_RESEND_COOLDOWN_SECONDS > 0:
        elapsed = (now - ensure_utc(latest_active.created_at)).total_seconds()
        if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
            wait_seconds = max(1, int(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed + 0.999))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait_seconds} seconds before requesting a new OTP.",
                headers={"Retry-After": str(wait_seconds)},
            )

    configured_code = settings.DEV_OTP_CODE.strip() if is_dev else ""
    otp_code = configured_code if configured_code else generate_otp(6)

    if not is_dev:
        dispatch_otp_sms(
            mobile=mobile,
            otp_code=otp_code,
            expires_minutes=settings.OTP_EXPIRE_MINUTES,
            purpose=purpose,
        )

    # Invalidate prior unconsumed OTPs for this mobile and purpose so only latest OTP is valid.
    existing_sessions = db.scalars(
        select(OTPSession).where(
            OTPSession.mobile == mobile,
            OTPSession.purpose == purpose,
            OTPSession.consumed.is_(False),
        )
    ).all()
    for session_row in existing_sessions:
        session_row.consumed = True

    expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
    otp_session = OTPSession(
        mobile=mobile,
        purpose=purpose,
        otp_hash=hash_otp(mobile, otp_code, purpose=purpose),
        expires_at=expires_at,
        attempts=0,
        consumed=False,
    )
    db.add(otp_session)
    db.commit()

    if is_dev:
        logger.info("Development OTP [%s] for %s: %s (expires in %sm)", purpose, mobile, otp_code, settings.OTP_EXPIRE_MINUTES)

    return RequestOTPOut(
        message=(
            "Development OTP generated (no live SMS sent)."
            if is_dev
            else "OTP sent to your mobile number via SMS."
        ),
        mobile=mobile,
        purpose=purpose,
        expires_in_seconds=settings.OTP_EXPIRE_MINUTES * 60,
        cooldown_seconds=settings.OTP_RESEND_COOLDOWN_SECONDS,
        dev_otp_mode=is_dev,
        dev_otp=otp_code if is_dev else None,
    )


def _verify_and_consume_otp_session(
    db: Session,
    *,
    mobile: str,
    otp_code: str,
    purpose: Literal["login", "registration"],
) -> OTPSession:
    """Validate OTP expiry, attempt limit, purpose, and hash, then mark consumed."""
    settings = get_settings()
    otp_session = db.scalar(
        select(OTPSession)
        .where(
            OTPSession.mobile == mobile,
            OTPSession.purpose == purpose,
            OTPSession.consumed.is_(False),
        )
        .order_by(OTPSession.id.desc())
    )
    if otp_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No active OTP request found. Please request a new OTP.",
        )

    now = datetime.now(timezone.utc)
    if ensure_utc(otp_session.expires_at) <= now:
        otp_session.consumed = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="OTP expired. Please request a new OTP.",
        )

    if otp_session.attempts >= settings.OTP_MAX_ATTEMPTS:
        otp_session.consumed = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Maximum OTP verification attempts exceeded. Request a new OTP.",
        )

    if not verify_otp_hash(mobile, otp_code.strip(), otp_session.otp_hash, purpose=purpose):
        otp_session.attempts += 1
        if otp_session.attempts >= settings.OTP_MAX_ATTEMPTS:
            otp_session.consumed = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OTP code. Please check and try again.",
        )

    otp_session.consumed = True
    return otp_session


def request_login_otp(
    db: Session,
    *,
    raw_mobile: str,
    portal_role: UserRole | None = None,
) -> RequestOTPOut:
    """Create a login OTP challenge for an existing active user."""
    settings = get_settings()
    if not settings.is_dev_otp_enabled and not settings.sms_provider_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMS OTP delivery provider is not configured. Use password login or enable DEV_OTP_MODE.",
        )

    mobile = _normalize_or_422(raw_mobile)
    _resolve_user_for_login(db, mobile, portal_role)
    return _issue_otp_session(db, mobile=mobile, purpose="login")


def verify_login_otp(
    db: Session,
    *,
    raw_mobile: str,
    otp_code: str,
    portal_role: UserRole | None = None,
) -> TokenOut:
    """Verify login OTP challenge against latest active session and return JWT."""
    mobile = _normalize_or_422(raw_mobile)
    user = _resolve_user_for_login(db, mobile, portal_role)
    _verify_and_consume_otp_session(db, mobile=mobile, otp_code=otp_code, purpose="login")
    db.commit()
    return _issue_token_response(db, user)


def list_public_pg_options(db: Session) -> list[PublicPGOptionOut]:
    """Return safe, zero-PII PG property metadata for tenant registration selection."""
    pgs = db.scalars(select(PGProperty).order_by(PGProperty.id.asc())).all()
    return [
        PublicPGOptionOut(
            id=pg.id,
            name=pg.name,
            city=pg.city,
            gender_policy=pg.gender_policy.value,
        )
        for pg in pgs
    ]


def request_tenant_registration_otp(
    db: Session,
    *,
    body: TenantRegisterOTPRequestIn,
) -> RequestOTPOut:
    """Issue a registration OTP for a new tenant mobile number (rejects duplicates without creating an account)."""
    if body.role is not None and body.role != UserRole.TENANT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is restricted to tenant accounts only.",
        )

    mobile = _normalize_or_422(body.mobile)
    existing = db.scalar(select(User).where(User.mobile == mobile))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this mobile number already exists. Please sign in instead.",
        )

    return _issue_otp_session(db, mobile=mobile, purpose="registration")


def complete_tenant_registration(
    db: Session,
    *,
    body: TenantSelfRegisterIn,
) -> TenantSelfRegisterOut:
    """Verify registration OTP, enforce TENANT role, and create User + onboarding notifications."""
    if body.role is not None and body.role != UserRole.TENANT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is restricted to tenant accounts only. Owner and Manager roles cannot be selected.",
        )

    clean_name = body.full_name.strip()
    if len(clean_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Full name must be at least 2 characters.",
        )

    mobile = _normalize_or_422(body.mobile)
    existing = db.scalar(select(User).where(User.mobile == mobile))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this mobile number already exists. Please sign in instead.",
        )

    selected_pg: PGProperty | None = None
    if body.pg_id is not None:
        selected_pg = db.get(PGProperty, body.pg_id)
        if selected_pg is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Selected PG property was not found.",
            )
    else:
        pgs = db.scalars(select(PGProperty).order_by(PGProperty.id.asc())).all()
        if len(pgs) == 1:
            selected_pg = pgs[0]
        elif len(pgs) > 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Please select the PG property you are registering for.",
            )

    _verify_and_consume_otp_session(
        db,
        mobile=mobile,
        otp_code=body.otp,
        purpose="registration",
    )

    new_user = User(
        pg_id=selected_pg.id if selected_pg is not None else None,
        full_name=clean_name,
        mobile=mobile,
        email=str(body.email) if body.email else None,
        password_hash=hash_password(body.password),
        role=UserRole.TENANT,  # Never trust client-supplied role; strictly assign TENANT.
        is_active=True,
    )
    db.add(new_user)
    db.flush()

    db.add(
        Notification(
            pg_id=new_user.pg_id,
            user_id=new_user.id,
            notif_type=NotificationType.GENERAL,
            title="Account Verified & Active",
            message=(
                "Welcome to Aapka PG! Your tenant account is active. "
                "Your PG Manager or Owner will link your room and bed allocation shortly."
            ),
        )
    )
    if selected_pg is not None:
        db.add(
            Notification(
                pg_id=selected_pg.id,
                user_id=selected_pg.owner_id,
                notif_type=NotificationType.GENERAL,
                title="New Tenant Self-Registered",
                message=f"{clean_name} ({mobile}) verified their account and is ready for bed allocation.",
            )
        )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this mobile number already exists. Please sign in instead.",
        ) from exc

    db.refresh(new_user)
    return TenantSelfRegisterOut(
        message="Tenant account verified and created successfully. You can now sign in.",
        user=build_user_out(db, new_user),
    )


def login_with_password(
    db: Session,
    *,
    raw_mobile: str,
    password: str,
    portal_role: UserRole | None = None,
) -> TokenOut:
    """Authenticate a registered user with mobile number and password."""
    mobile = _normalize_or_422(raw_mobile)
    user = _resolve_user_for_login(db, mobile, portal_role)

    if not user.password_hash or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid mobile number or password.",
        )

    return _issue_token_response(db, user)


def revoke_token(db: Session, *, jti: str, exp_ts: int) -> None:
    """Persist JWT JTI in revocation list so logged-out tokens cannot be reused."""
    existing = db.scalar(select(RevokedToken).where(RevokedToken.jti == jti))
    if existing is None:
        expires_at = datetime.fromtimestamp(exp_ts, tz=timezone.utc)
        db.add(RevokedToken(jti=jti, expires_at=expires_at))
        db.commit()


def register_user_account(
    db: Session,
    *,
    current_user: User | None,
    body: RegisterUserIn,
) -> UserOut:
    """Controlled user registration: public callers cannot register or choose OWNER role."""
    if body.role == UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner role cannot be selected through registration.",
        )

    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public self-registration is disabled. Accounts must be onboarded by an Owner or Manager.",
        )

    if current_user.role == UserRole.TENANT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenants cannot register user accounts.",
        )

    if current_user.role == UserRole.MANAGER and body.role != UserRole.TENANT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an authorized Owner can create Manager accounts.",
        )

    mobile = _normalize_or_422(body.mobile)
    existing = db.scalar(select(User).where(User.mobile == mobile))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this mobile number already exists.",
        )

    new_user = User(
        pg_id=current_user.pg_id,
        full_name=body.full_name.strip(),
        mobile=mobile,
        email=str(body.email) if body.email else None,
        password_hash=hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return build_user_out(db, new_user)


def list_pg_users(db: Session, *, current_user: User) -> list[UserOut]:
    """List all user accounts within the owner's PG property."""
    query = select(User).order_by(User.id.asc())
    if current_user.pg_id is not None:
        query = query.where(User.pg_id == current_user.pg_id)
    users = db.scalars(query).all()
    return [build_user_out(db, u) for u in users]


def get_user_by_id_isolated(
    db: Session,
    *,
    current_user: User,
    target_user_id: int,
) -> UserOut:
    """Allow users to read only their own record, or Owner to inspect users in their PG."""
    target = db.get(User, target_user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if current_user.id != target.id:
        if current_user.role != UserRole.OWNER or (
            current_user.pg_id is not None and target.pg_id != current_user.pg_id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot access another user's protected account information.",
            )
    return build_user_out(db, target)


def update_user_by_owner(
    db: Session,
    *,
    current_user: User,
    target_user_id: int,
    body: UserUpdateIn,
) -> UserOut:
    """Allow an Owner to manage user status/roles (excluding self-deactivation or creating Owners)."""
    target = db.get(User, target_user_id)
    if target is None or (
        current_user.pg_id is not None and target.pg_id != current_user.pg_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if body.role is not None:
        if body.role == UserRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot promote user to Owner via this endpoint.",
            )
        if target.id == current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Owner cannot downgrade their own role.",
            )
        target.role = body.role

    if body.is_active is not None:
        if target.id == current_user.id and not body.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Owner cannot deactivate their own account.",
            )
        target.is_active = body.is_active

    if body.full_name is not None:
        target.full_name = body.full_name.strip()
    if body.email is not None:
        target.email = str(body.email)

    db.commit()
    db.refresh(target)
    return build_user_out(db, target)

