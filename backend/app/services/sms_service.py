import logging

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings

logger = logging.getLogger("aapka_pg.sms")


def dispatch_otp_sms(
    *,
    mobile: str,
    otp_code: str,
    expires_minutes: int,
    purpose: str,
) -> None:
    """Dispatch OTP SMS in non-development mode, or fail clearly if no SMS provider is configured."""
    settings = get_settings()
    if not settings.sms_provider_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "SMS OTP delivery provider is not configured. Configure SMS_PROVIDER and "
                "SMS_API_KEY (or use password login)."
            ),
        )

    provider = settings.SMS_PROVIDER.strip().lower()
    if provider == "webhook":
        webhook_url = settings.SMS_WEBHOOK_URL.strip()
        if not webhook_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="SMS webhook provider selected, but SMS_WEBHOOK_URL is empty.",
            )
        try:
            resp = httpx.post(
                webhook_url,
                headers={"Authorization": f"Bearer {settings.SMS_API_KEY.strip()}"},
                json={
                    "to": mobile,
                    "sender_id": settings.SMS_SENDER_ID.strip() or "AAPKAPG",
                    "purpose": purpose,
                    "message": f"Your Aapka PG verification code is {otp_code}. Valid for {expires_minutes} minutes.",
                },
                timeout=8.0,
            )
            resp.raise_for_status()
            return
        except httpx.HTTPError as exc:
            logger.exception("SMS webhook dispatch failed for %s: %s", mobile, exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to deliver OTP through configured SMS gateway.",
            ) from exc

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            f"SMS provider '{settings.SMS_PROVIDER}' adapter is not configured in this deployment. "
            "Configure SMS_PROVIDER=webhook with SMS_WEBHOOK_URL or contact administrator."
        ),
    )

