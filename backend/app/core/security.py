import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import get_settings


def hash_password(plain_password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    rounds = get_settings().BCRYPT_ROUNDS
    salt = bcrypt.gensalt(rounds=rounds)
    return bcrypt.hashpw(plain_password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Verify a plaintext password against its bcrypt hash."""
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def normalize_mobile(raw_mobile: str) -> str:
    """Normalize mobile numbers consistently (defaults 10-digit Indian numbers to +91...)."""
    cleaned = "".join(ch for ch in raw_mobile.strip() if ch.isdigit() or ch == "+")
    if cleaned.startswith("+"):
        digits = "+" + "".join(ch for ch in cleaned[1:] if ch.isdigit())
        if len(digits) < 10 or len(digits) > 16:
            raise ValueError("Invalid mobile number length.")
        return digits

    digits_only = "".join(ch for ch in cleaned if ch.isdigit())
    if len(digits_only) == 10:
        return f"+91{digits_only}"
    if len(digits_only) == 12 and digits_only.startswith("91"):
        return f"+{digits_only}"
    if 10 < len(digits_only) <= 15:
        return f"+{digits_only}"
    raise ValueError("Mobile number must contain 10 digits or valid country code.")


def generate_otp(digits: int = 6) -> str:
    """Generate a cryptographically random numeric OTP."""
    upper = 10**digits
    return f"{secrets.randbelow(upper):0{digits}d}"


def hash_otp(mobile: str, otp: str, purpose: str = "login") -> str:
    """Create a keyed HMAC-SHA256 hash of an OTP bound to mobile number and purpose."""
    settings = get_settings()
    payload = f"{purpose}:{mobile}:{otp}".encode("utf-8")
    return hmac.new(settings.JWT_SECRET_KEY.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_otp_hash(
    mobile: str,
    otp: str,
    expected_hash: str,
    purpose: str = "login",
) -> bool:
    """Constant-time verification of a user-provided OTP bound to mobile number and purpose."""
    candidate = hash_otp(mobile, otp, purpose=purpose)
    return hmac.compare_digest(candidate, expected_hash)


def create_access_token(
    *,
    user_id: int,
    role: str,
    pg_id: int | None,
    expires_minutes: int | None = None,
) -> tuple[str, str, datetime]:
    """Create a signed JWT access token and return (token, jti, expires_at)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    ttl = expires_minutes if expires_minutes is not None else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    expires_at = now + timedelta(minutes=ttl)
    jti = uuid.uuid4().hex

    payload = {
        "sub": str(user_id),
        "role": role,
        "pg_id": pg_id,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, jti, expires_at


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT access token."""
    settings = get_settings()
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
    )

