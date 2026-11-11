from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.enums import UserRole
from app.models.notification import Notification
from app.models.user import OTPSession, User
from tests.conftest import bearer, login_token


def test_1_existing_user_requests_random_otp_and_logs_in(
    seeded_client, db_session: Session
):
    req = seeded_client.post("/api/auth/request-otp", json={"mobile": "9800000003"})
    assert req.status_code == 200, req.text
    data = req.json()
    assert data["dev_otp_mode"] is True
    assert data["purpose"] == "login"
    assert data["expires_in_seconds"] == get_settings().OTP_EXPIRE_MINUTES * 60
    assert data["dev_otp"] is not None
    assert len(data["dev_otp"]) == 6
    assert data["dev_otp"].isdigit()

    otp_row = db_session.scalar(
        select(OTPSession)
        .where(OTPSession.mobile == "+919800000003", OTPSession.purpose == "login")
        .order_by(OTPSession.id.desc())
    )
    assert otp_row is not None
    assert otp_row.otp_hash != data["dev_otp"]
    assert otp_row.consumed is False

    ver = seeded_client.post(
        "/api/auth/verify-otp",
        json={"mobile": "9800000003", "otp": data["dev_otp"]},
    )
    assert ver.status_code == 200
    assert ver.json()["user"]["role"] == "tenant"
    assert ver.json()["access_token"]


def test_2_dev_otp_only_returned_in_dev_mode_and_production_errors_or_hides_otp(
    seeded_client, monkeypatch
):
    settings = get_settings()

    # Production without SMS provider returns 503 configuration error (never pretends SMS was sent).
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    cfg = seeded_client.get("/api/auth/config")
    assert cfg.status_code == 200
    assert cfg.json()["dev_otp_mode"] is False
    assert cfg.json()["sms_provider_configured"] is False

    unconfigured_resp = seeded_client.post(
        "/api/auth/request-otp", json={"mobile": "9800000003"}
    )
    assert unconfigured_resp.status_code == 503

    # Production WITH configured webhook SMS provider dispatches without exposing dev_otp.
    captured_payloads = []

    class _FakeResp:
        def raise_for_status(self):
            return None

    def _fake_post(url, headers=None, json=None, timeout=8.0):
        captured_payloads.append({"url": url, "json": json})
        return _FakeResp()

    monkeypatch.setattr(settings, "SMS_PROVIDER", "webhook")
    monkeypatch.setattr(settings, "SMS_API_KEY", "test-sms-key")
    monkeypatch.setattr(settings, "SMS_WEBHOOK_URL", "https://sms.example.test/send")
    monkeypatch.setattr("app.services.sms_service.httpx.post", _fake_post)

    prod_resp = seeded_client.post(
        "/api/auth/request-otp", json={"mobile": "9800000003"}
    )
    assert prod_resp.status_code == 200, prod_resp.text
    prod_body = prod_resp.json()
    assert prod_body["dev_otp_mode"] is False
    assert prod_body["dev_otp"] is None
    assert len(captured_payloads) == 1
    assert captured_payloads[0]["json"]["to"] == "+919800000003"


def test_3_4_5_6_otp_verification_rejection_expiry_and_reuse_prevention(
    seeded_client, db_session: Session
):
    req = seeded_client.post("/api/auth/request-otp", json={"mobile": "9800000002"})
    assert req.status_code == 200
    otp = req.json()["dev_otp"]

    # Wrong OTP rejected
    bad = seeded_client.post(
        "/api/auth/verify-otp", json={"mobile": "9800000002", "otp": "000000"}
    )
    assert bad.status_code == 401

    # Valid OTP succeeds
    ok = seeded_client.post(
        "/api/auth/verify-otp", json={"mobile": "9800000002", "otp": otp}
    )
    assert ok.status_code == 200
    assert ok.json()["user"]["role"] == "manager"

    # Reusing already verified OTP must be blocked
    reuse = seeded_client.post(
        "/api/auth/verify-otp", json={"mobile": "9800000002", "otp": otp}
    )
    assert reuse.status_code == 401

    # Expired OTP rejected
    req2 = seeded_client.post("/api/auth/request-otp", json={"mobile": "9800000002"})
    assert req2.status_code == 200
    otp2 = req2.json()["dev_otp"]
    session_row = db_session.scalar(
        select(OTPSession)
        .where(OTPSession.mobile == "+919800000002", OTPSession.purpose == "login")
        .order_by(OTPSession.id.desc())
    )
    assert session_row is not None
    session_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db_session.commit()

    expired = seeded_client.post(
        "/api/auth/verify-otp", json={"mobile": "9800000002", "otp": otp2}
    )
    assert expired.status_code == 401


def test_otp_resend_cooldown_and_rate_limiting(
    seeded_client, db_session: Session, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "OTP_RESEND_COOLDOWN_SECONDS", 30)
    monkeypatch.setattr(settings, "OTP_RATE_LIMIT_MAX_REQUESTS", 3)

    first = seeded_client.post(
        "/api/auth/tenant-register/request-otp", json={"mobile": "9812345601"}
    )
    assert first.status_code == 200

    # Immediate unconsumed resend must trigger 429 cooldown
    second_immediate = seeded_client.post(
        "/api/auth/tenant-register/request-otp", json={"mobile": "9812345601"}
    )
    assert second_immediate.status_code == 429
    assert "Retry-After" in second_immediate.headers

    # Bypass cooldown to test window max-requests cap (3 max -> 4th must 429 even after verifying/aging)
    monkeypatch.setattr(settings, "OTP_RESEND_COOLDOWN_SECONDS", 0)
    r2 = seeded_client.post(
        "/api/auth/tenant-register/request-otp", json={"mobile": "9812345601"}
    )
    assert r2.status_code == 200
    r3 = seeded_client.post(
        "/api/auth/tenant-register/request-otp", json={"mobile": "9812345601"}
    )
    assert r3.status_code == 200
    r4 = seeded_client.post(
        "/api/auth/tenant-register/request-otp", json={"mobile": "9812345601"}
    )
    assert r4.status_code == 429

    # Still zero account created without OTP verification
    assert (
        db_session.scalar(select(User).where(User.mobile == "+919812345601"))
        is None
    )


def test_7_8_9_10_11_12_tenant_registration_security_and_rbac(
    seeded_client, db_session: Session, monkeypatch
):
    # 9. Unregistered number cannot log in before registration (OTP or password)
    pre_otp = seeded_client.post(
        "/api/auth/request-otp", json={"mobile": "9877700011"}
    )
    assert pre_otp.status_code == 401
    pre_pw = seeded_client.post(
        "/api/auth/login",
        json={"mobile": "9877700011", "password": "Password@123"},
    )
    assert pre_pw.status_code == 401
    assert (
        db_session.scalar(select(User).where(User.mobile == "+919877700011"))
        is None
    )

    # Registration options endpoint returns PG metadata cleanly
    opts = seeded_client.get("/api/auth/registration-options")
    assert opts.status_code == 200
    pg_id = opts.json()[0]["id"]

    # 7. Request registration OTP -> account must NOT exist before OTP verification
    reg_otp_req = seeded_client.post(
        "/api/auth/tenant-register/request-otp", json={"mobile": "9877700011"}
    )
    assert reg_otp_req.status_code == 200
    reg_otp = reg_otp_req.json()["dev_otp"]
    assert reg_otp and len(reg_otp) == 6
    assert (
        db_session.scalar(select(User).where(User.mobile == "+919877700011"))
        is None
    )

    # Purpose isolation: a registration OTP cannot be accepted by login verify-otp
    cross_login = seeded_client.post(
        "/api/auth/verify-otp",
        json={"mobile": "9877700011", "otp": reg_otp},
    )
    assert cross_login.status_code == 401

    # 10. Tenant cannot self-register as Owner or Manager (backend rejects role spoofing)
    for bad_role in ("owner", "manager"):
        spoof_req = seeded_client.post(
            "/api/auth/tenant-register/request-otp",
            json={"mobile": "9877700099", "role": bad_role},
        )
        assert spoof_req.status_code == 403

        spoof_complete = seeded_client.post(
            "/api/auth/tenant-register/verify",
            json={
                "full_name": "Attacker",
                "mobile": "9877700011",
                "email": "attacker@example.com",
                "password": "Password@123",
                "otp": reg_otp,
                "pg_id": pg_id,
                "role": bad_role,
            },
        )
        assert spoof_complete.status_code == 403

    # Wrong OTP on registration does NOT create an account
    bad_verify = seeded_client.post(
        "/api/auth/tenant-register/verify",
        json={
            "full_name": "Kiran Rao",
            "mobile": "9877700011",
            "email": "kiran@example.com",
            "password": "Password@123",
            "otp": "000000",
            "pg_id": pg_id,
        },
    )
    assert bad_verify.status_code == 401
    assert (
        db_session.scalar(select(User).where(User.mobile == "+919877700011"))
        is None
    )

    # Complete registration with valid OTP
    ok_reg = seeded_client.post(
        "/api/auth/tenant-register/verify",
        json={
            "full_name": "Kiran Rao",
            "mobile": "9877700011",
            "email": "kiran@example.com",
            "password": "Password@123",
            "otp": reg_otp,
            "pg_id": pg_id,
        },
    )
    assert ok_reg.status_code == 200, ok_reg.text
    created_user = ok_reg.json()["user"]
    assert created_user["full_name"] == "Kiran Rao"
    assert created_user["mobile"] == "+919877700011"
    assert created_user["role"] == "tenant"
    assert created_user["pg_id"] == pg_id
    assert created_user["is_active"] is True

    # Welcome & Owner notifications created
    notifs = db_session.scalars(
        select(Notification).where(Notification.user_id == created_user["id"])
    ).all()
    assert len(notifs) == 1

    # Reusing the registration OTP fails
    reuse_reg = seeded_client.post(
        "/api/auth/tenant-register/verify",
        json={
            "full_name": "Kiran Duplicate",
            "mobile": "9877700011",
            "password": "Password@123",
            "otp": reg_otp,
            "pg_id": pg_id,
        },
    )
    assert reuse_reg.status_code in (401, 409)

    # 8. Duplicate mobile registration rejected on OTP request
    dup_req = seeded_client.post(
        "/api/auth/tenant-register/request-otp", json={"mobile": "9877700011"}
    )
    assert dup_req.status_code == 409

    # 11. Newly registered tenant can log in with Password AND OTP, and 12. RBAC enforced
    new_tok = login_token(seeded_client, "9877700011", "Password@123", portal_role="tenant")
    me_resp = seeded_client.get("/api/auth/me", headers=bearer(new_tok))
    assert me_resp.status_code == 200
    assert me_resp.json()["role"] == "tenant"

    # RBAC isolation checks
    assert seeded_client.get("/api/owner/finance/dashboard", headers=bearer(new_tok)).status_code == 403
    assert seeded_client.get("/api/v1/manager/overview", headers=bearer(new_tok)).status_code == 403
    assert seeded_client.get("/api/rooms", headers=bearer(new_tok)).status_code == 403
    assert seeded_client.get("/api/auth/users", headers=bearer(new_tok)).status_code == 403
    assert seeded_client.get("/api/auth/portal/tenant", headers=bearer(new_tok)).status_code == 200

    # Existing Owner/Manager password logins and RBAC continue working
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123", portal_role="owner")
    assert seeded_client.get("/api/auth/users", headers=bearer(owner_tok)).status_code == 200
    users_in_pg = seeded_client.get("/api/auth/users", headers=bearer(owner_tok)).json()
    assert any(u["mobile"] == "+919877700011" and u["role"] == "tenant" for u in users_in_pg)

    # Newly registered tenant can also use OTP login
    monkeypatch.setattr(get_settings(), "OTP_RESEND_COOLDOWN_SECONDS", 0)
    login_otp_req = seeded_client.post(
        "/api/auth/request-otp", json={"mobile": "9877700011"}
    )
    assert login_otp_req.status_code == 200
    login_otp_code = login_otp_req.json()["dev_otp"]
    otp_login_ver = seeded_client.post(
        "/api/auth/verify-otp",
        json={"mobile": "9877700011", "otp": login_otp_code},
    )
    assert otp_login_ver.status_code == 200
    assert otp_login_ver.json()["user"]["id"] == created_user["id"]

