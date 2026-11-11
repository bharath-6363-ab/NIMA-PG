from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token
from app.models.user import User
from tests.conftest import bearer, login_token


def test_1_successful_password_and_configurable_dev_otp_login(seeded_client, monkeypatch):
    # Password login via /api/auth/login
    resp = seeded_client.post(
        "/api/auth/login",
        json={"mobile": "9800000001", "password": "Owner@123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["role"] == "owner"
    assert "password_hash" not in body["user"]

    # Configurable development OTP login via /api/auth/request-otp + /api/auth/verify-otp
    monkeypatch.setattr(get_settings(), "DEV_OTP_CODE", "424242")
    req = seeded_client.post("/api/auth/request-otp", json={"mobile": "9800000003"})
    assert req.status_code == 200
    assert req.json()["dev_otp_mode"] is True
    assert req.json()["dev_otp"] == "424242"

    ver = seeded_client.post(
        "/api/auth/verify-otp",
        json={"mobile": "9800000003", "otp": "424242"},
    )
    assert ver.status_code == 200
    assert ver.json()["user"]["role"] == "tenant"


def test_2_invalid_otp_rejected(seeded_client):
    req = seeded_client.post("/api/auth/request-otp", json={"mobile": "9800000002"})
    assert req.status_code == 200
    bad = seeded_client.post(
        "/api/auth/verify-otp",
        json={"mobile": "9800000002", "otp": "999999"},
    )
    assert bad.status_code == 401


def test_3_invalid_credentials_rejected(seeded_client):
    wrong_pw = seeded_client.post(
        "/api/auth/login",
        json={"mobile": "9800000001", "password": "WrongPassword!"},
    )
    assert wrong_pw.status_code == 401

    unknown_user = seeded_client.post(
        "/api/auth/login",
        json={"mobile": "9899999999", "password": "Owner@123"},
    )
    assert unknown_user.status_code == 401


def test_4_missing_auth_token_rejected(seeded_client):
    assert seeded_client.get("/api/auth/me").status_code == 401
    assert seeded_client.get("/api/auth/users").status_code == 401
    assert seeded_client.get("/api/auth/portal/owner").status_code == 401
    assert seeded_client.get("/api/auth/portal/manager").status_code == 401
    assert seeded_client.get("/api/auth/portal/tenant").status_code == 401


def test_5_expired_or_invalid_jwt_rejected(seeded_client, db_session: Session):
    # Invalid / tampered JWT
    assert (
        seeded_client.get("/api/auth/me", headers=bearer("not.a.valid.jwt")).status_code
        == 401
    )

    # Expired JWT
    owner = db_session.scalar(select(User).where(User.mobile == "+919800000001"))
    assert owner is not None
    expired_token, _jti, _exp = create_access_token(
        user_id=owner.id,
        role=owner.role.value,
        pg_id=owner.pg_id,
        expires_minutes=-5,
    )
    assert seeded_client.get("/api/auth/me", headers=bearer(expired_token)).status_code == 401


def test_6_owner_only_endpoint_access(seeded_client):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    assert seeded_client.get("/api/auth/portal/owner", headers=bearer(owner_tok)).status_code == 200
    assert seeded_client.get("/api/auth/users", headers=bearer(owner_tok)).status_code == 200

    assert seeded_client.get("/api/auth/portal/owner", headers=bearer(mgr_tok)).status_code == 403
    assert seeded_client.get("/api/auth/users", headers=bearer(mgr_tok)).status_code == 403

    assert seeded_client.get("/api/auth/portal/owner", headers=bearer(tenant_tok)).status_code == 403
    assert seeded_client.get("/api/auth/users", headers=bearer(tenant_tok)).status_code == 403


def test_7_manager_access_restrictions(seeded_client, db_session: Session):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")

    # Manager accesses manager portal
    assert seeded_client.get("/api/auth/portal/manager", headers=bearer(mgr_tok)).status_code == 200

    # Manager cannot create another owner or manager
    assert (
        seeded_client.post(
            "/api/auth/register",
            headers=bearer(mgr_tok),
            json={
                "full_name": "Rogue Owner",
                "mobile": "9811112221",
                "password": "Password@123",
                "role": "owner",
            },
        ).status_code
        == 403
    )
    assert (
        seeded_client.post(
            "/api/auth/register",
            headers=bearer(mgr_tok),
            json={
                "full_name": "Rogue Manager",
                "mobile": "9811112222",
                "password": "Password@123",
                "role": "manager",
            },
        ).status_code
        == 403
    )

    # Manager cannot change their own role
    mgr = db_session.scalar(select(User).where(User.mobile == "+919800000002"))
    assert mgr is not None
    assert (
        seeded_client.patch(
            f"/api/auth/users/{mgr.id}",
            headers=bearer(mgr_tok),
            json={"role": "owner"},
        ).status_code
        == 403
    )

    # Owner CAN create a manager via /api/auth/register
    ok_mgr = seeded_client.post(
        "/api/auth/register",
        headers=bearer(owner_tok),
        json={
            "full_name": "New Manager",
            "mobile": "9811112223",
            "password": "Password@123",
            "role": "manager",
        },
    )
    assert ok_mgr.status_code == 200
    assert ok_mgr.json()["role"] == "manager"


def test_8_tenant_access_restrictions(seeded_client):
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    assert seeded_client.get("/api/auth/portal/tenant", headers=bearer(tenant_tok)).status_code == 200
    assert seeded_client.get("/api/auth/portal/manager", headers=bearer(tenant_tok)).status_code == 403
    assert seeded_client.get("/api/auth/portal/owner", headers=bearer(tenant_tok)).status_code == 403
    assert (
        seeded_client.post(
            "/api/auth/register",
            headers=bearer(tenant_tok),
            json={
                "full_name": "Unauthorized Tenant Create",
                "mobile": "9811113333",
                "password": "Password@123",
                "role": "tenant",
            },
        ).status_code
        == 403
    )


def test_9_public_registration_cannot_create_owner(seeded_client):
    resp_owner = seeded_client.post(
        "/api/auth/register",
        json={
            "full_name": "Public Owner",
            "mobile": "9877777771",
            "password": "Password@123",
            "role": "owner",
        },
    )
    assert resp_owner.status_code == 403

    resp_tenant = seeded_client.post(
        "/api/auth/register",
        json={
            "full_name": "Public Self Reg",
            "mobile": "9877777772",
            "password": "Password@123",
            "role": "tenant",
        },
    )
    assert resp_tenant.status_code == 403


def test_10_inactive_user_cannot_login(seeded_client, db_session: Session):
    user = db_session.scalar(select(User).where(User.mobile == "+919800000003"))
    assert user is not None
    user.is_active = False
    db_session.commit()

    pw_login = seeded_client.post(
        "/api/auth/login",
        json={"mobile": "9800000003", "password": "Tenant@123"},
    )
    assert pw_login.status_code == 403

    otp_req = seeded_client.post("/api/auth/request-otp", json={"mobile": "9800000003"})
    assert otp_req.status_code == 403


def test_11_user_cannot_access_another_users_protected_info(seeded_client, db_session: Session):
    rahul = db_session.scalar(select(User).where(User.mobile == "+919800000003"))
    neha = db_session.scalar(select(User).where(User.mobile == "+919800000004"))
    owner = db_session.scalar(select(User).where(User.mobile == "+919800000001"))
    assert rahul and neha and owner

    rahul_tok = login_token(seeded_client, "9800000003", "Tenant@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")

    # Tenant can inspect own record, blocked from Neha's and Owner's records
    assert seeded_client.get(f"/api/auth/users/{rahul.id}", headers=bearer(rahul_tok)).status_code == 200
    assert seeded_client.get(f"/api/auth/users/{neha.id}", headers=bearer(rahul_tok)).status_code == 403
    assert seeded_client.get(f"/api/auth/users/{owner.id}", headers=bearer(rahul_tok)).status_code == 403

    # Manager cannot inspect Owner's protected user record
    assert seeded_client.get(f"/api/auth/users/{owner.id}", headers=bearer(mgr_tok)).status_code == 403

    # Owner can inspect PG user records
    assert seeded_client.get(f"/api/auth/users/{neha.id}", headers=bearer(owner_tok)).status_code == 200

