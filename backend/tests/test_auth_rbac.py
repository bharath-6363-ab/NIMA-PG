from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import OTPSession, User
from tests.conftest import bearer, login_token


def test_health_and_openapi_exclude_electricity(client):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    schema = client.get("/openapi.json")
    assert schema.status_code == 200
    raw = schema.text.lower()
    assert "electricity" not in raw
    assert "meter_reading" not in raw


def test_auth_config_exposes_dev_otp_mode(client):
    resp = client.get("/api/v1/auth/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["dev_otp_mode"] is True
    assert data["sms_provider_configured"] is False


def test_owner_manager_tenant_password_logins(seeded_client):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123", portal_role="owner")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123", portal_role="manager")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123", portal_role="tenant")

    assert seeded_client.get("/api/v1/auth/me", headers=bearer(owner_tok)).json()["role"] == "owner"
    assert seeded_client.get("/api/v1/auth/me", headers=bearer(mgr_tok)).json()["role"] == "manager"
    assert seeded_client.get("/api/v1/auth/me", headers=bearer(tenant_tok)).json()["role"] == "tenant"


def test_dev_otp_login_flow_and_invalid_otp_rejection(seeded_client, db_session: Session):
    req = seeded_client.post("/api/v1/auth/otp/request", json={"mobile": "9800000003"})
    assert req.status_code == 200
    data = req.json()
    assert data["dev_otp_mode"] is True
    dev_otp = data["dev_otp"]
    assert dev_otp and len(dev_otp) == 6

    wrong = seeded_client.post("/api/v1/auth/otp/verify", json={"mobile": "9800000003", "otp": "000000"})
    assert wrong.status_code == 401

    ok = seeded_client.post("/api/v1/auth/otp/verify", json={"mobile": "9800000003", "otp": dev_otp})
    assert ok.status_code == 200
    token = ok.json()["access_token"]
    assert ok.json()["user"]["role"] == "tenant"

    # Reusing a consumed OTP must fail
    reuse = seeded_client.post("/api/v1/auth/otp/verify", json={"mobile": "9800000003", "otp": dev_otp})
    assert reuse.status_code == 401

    # Expired OTP must fail
    req2 = seeded_client.post("/api/v1/auth/otp/request", json={"mobile": "9800000003"})
    otp2 = req2.json()["dev_otp"]
    session_row = db_session.scalar(select(OTPSession).order_by(OTPSession.id.desc()))
    assert session_row is not None
    session_row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    expired = seeded_client.post("/api/v1/auth/otp/verify", json={"mobile": "9800000003", "otp": otp2})
    assert expired.status_code == 401
    assert seeded_client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 200


def test_unknown_mobile_and_role_spoofing_blocked(seeded_client):
    # Unknown user cannot request OTP or self-assign a role
    unknown = seeded_client.post(
        "/api/v1/auth/otp/request",
        json={"mobile": "9999999999", "portal_role": "owner"},
    )
    assert unknown.status_code == 401

    # Tenant cannot log into Owner (Malik) or Manager portals
    spoof_otp = seeded_client.post(
        "/api/v1/auth/otp/request",
        json={"mobile": "9800000003", "portal_role": "owner"},
    )
    assert spoof_otp.status_code == 403

    spoof_pw = seeded_client.post(
        "/api/v1/auth/login",
        json={"mobile": "9800000003", "password": "Tenant@123", "portal_role": "manager"},
    )
    assert spoof_pw.status_code == 403

    # Manager cannot log into Owner portal
    mgr_spoof = seeded_client.post(
        "/api/v1/auth/login",
        json={"mobile": "9800000002", "password": "Manager@123", "portal_role": "owner"},
    )
    assert mgr_spoof.status_code == 403


def test_logout_revokes_token_immediately(seeded_client):
    token = login_token(seeded_client, "9800000001", "Owner@123")
    assert seeded_client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 200

    logout_resp = seeded_client.post("/api/v1/auth/logout", headers=bearer(token))
    assert logout_resp.status_code == 200

    reused = seeded_client.get("/api/v1/auth/me", headers=bearer(token))
    assert reused.status_code == 401


def test_rbac_endpoint_isolation(seeded_client):
    # Unauthenticated access rejected
    assert seeded_client.get("/api/v1/owner/pg").status_code == 401
    assert seeded_client.get("/api/v1/manager/overview").status_code == 401
    assert seeded_client.get("/api/v1/tenant/profile").status_code == 401

    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    # Owner accesses owner & manager endpoints, not tenant profile
    assert seeded_client.get("/api/v1/owner/pg", headers=bearer(owner_tok)).status_code == 200
    assert seeded_client.get("/api/v1/manager/overview", headers=bearer(owner_tok)).status_code == 200
    assert seeded_client.get("/api/v1/tenant/profile", headers=bearer(owner_tok)).status_code == 403

    # Manager accesses manager overview, blocked from owner settings & tenant profile
    assert seeded_client.get("/api/v1/manager/overview", headers=bearer(mgr_tok)).status_code == 200
    assert seeded_client.get("/api/v1/owner/pg", headers=bearer(mgr_tok)).status_code == 403
    assert seeded_client.get("/api/v1/tenant/profile", headers=bearer(mgr_tok)).status_code == 403

    # Tenant accesses only tenant profile, blocked from owner and manager endpoints
    profile = seeded_client.get("/api/v1/tenant/profile", headers=bearer(tenant_tok))
    assert profile.status_code == 200
    assert profile.json()["full_name"] == "Rahul Sharma"
    assert seeded_client.get("/api/v1/manager/overview", headers=bearer(tenant_tok)).status_code == 403
    assert seeded_client.get("/api/v1/owner/pg", headers=bearer(tenant_tok)).status_code == 403


def test_deactivated_user_blocked(seeded_client, db_session: Session):
    token = login_token(seeded_client, "9800000002", "Manager@123")
    mgr = db_session.scalar(select(User).where(User.mobile == "+919800000002"))
    assert mgr is not None
    mgr.is_active = False
    db_session.commit()

    assert seeded_client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 401


def test_dev_otp_disabled_fails_safely(seeded_client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "DEV_OTP_MODE", False)
    resp = seeded_client.post("/api/v1/auth/otp/request", json={"mobile": "9800000003"})
    assert resp.status_code == 503

