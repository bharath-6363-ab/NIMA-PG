from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import BedStatus, DepositStatus, TenantStatus
from app.models.finance import SecurityDeposit
from app.models.property import Bed
from app.models.tenant import Tenant, TenantAllocationHistory
from tests.conftest import bearer, login_token


def test_1_2_3_6_room_management_permissions_and_duplicates(seeded_client):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    # 1. Owner can create a room
    r_owner = seeded_client.post(
        "/api/rooms",
        headers=bearer(owner_tok),
        json={
            "room_number": "301",
            "floor": "3rd Floor",
            "sharing_type": "double",
            "max_capacity": 2,
            "description": "Corner balcony double room",
            "base_rent": "8500.00",
            "food_charges": "1000.00",
        },
    )
    assert r_owner.status_code == 200, r_owner.text
    r301 = r_owner.json()
    assert r301["room_number"] == "301"
    assert r301["total_beds"] == 2

    # 2. Manager can create a room within their authorized property
    r_mgr = seeded_client.post(
        "/api/rooms",
        headers=bearer(mgr_tok),
        json={
            "room_number": "302",
            "floor": "3rd Floor",
            "sharing_type": "single",
            "max_capacity": 2,
            "base_rent": "10500.00",
            "auto_create_beds": True,
        },
    )
    assert r_mgr.status_code == 200, r_mgr.text
    r302 = r_mgr.json()
    assert r302["room_number"] == "302"

    # 3. Tenant cannot create, edit, or delete a room
    assert (
        seeded_client.post(
            "/api/rooms",
            headers=bearer(tenant_tok),
            json={
                "room_number": "999",
                "floor": "9th",
                "sharing_type": "single",
                "max_capacity": 1,
                "base_rent": "5000.00",
            },
        ).status_code
        == 403
    )
    assert (
        seeded_client.patch(
            f"/api/rooms/{r301['id']}",
            headers=bearer(tenant_tok),
            json={"base_rent": "1000.00"},
        ).status_code
        == 403
    )

    # 6. Duplicate room number rejected
    dup_room = seeded_client.post(
        "/api/rooms",
        headers=bearer(mgr_tok),
        json={
            "room_number": "301",
            "floor": "3rd Floor",
            "sharing_type": "double",
            "max_capacity": 2,
            "base_rent": "8500.00",
        },
    )
    assert dup_room.status_code == 409

    # Safe delete works on empty unused room 302, blocked on room 101 with tenants
    rooms_list = seeded_client.get("/api/rooms", headers=bearer(mgr_tok)).json()
    room_101 = next(r for r in rooms_list if r["room_number"] == "101")
    assert seeded_client.delete(f"/api/rooms/{room_101['id']}", headers=bearer(owner_tok)).status_code == 409
    assert seeded_client.delete(f"/api/rooms/{r302['id']}", headers=bearer(mgr_tok)).status_code == 200


def test_4_5_6_bed_management_capacity_and_duplicate_labels(seeded_client):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    room = seeded_client.post(
        "/api/rooms",
        headers=bearer(owner_tok),
        json={
            "room_number": "401",
            "floor": "4th Floor",
            "sharing_type": "triple",
            "max_capacity": 3,
            "base_rent": "7000.00",
            "auto_create_beds": False,
        },
    ).json()

    # 4. Owner can add beds
    b1 = seeded_client.post(
        "/api/beds",
        headers=bearer(owner_tok),
        json={
            "room_id": room["id"],
            "bed_label": "A",
            "monthly_rent": "7000.00",
            "food_charges": "1000.00",
        },
    )
    assert b1.status_code == 200

    # 5. Manager can add beds
    b2 = seeded_client.post(
        "/api/beds",
        headers=bearer(mgr_tok),
        json={
            "room_id": room["id"],
            "bed_label": "B",
            "monthly_rent": "7200.00",
            "food_charges": "1000.00",
        },
    )
    assert b2.status_code == 200

    # 6. Duplicate bed label inside same room rejected
    dup_bed = seeded_client.post(
        "/api/beds",
        headers=bearer(mgr_tok),
        json={
            "room_id": room["id"],
            "bed_label": "A",
            "monthly_rent": "7000.00",
        },
    )
    assert dup_bed.status_code == 409

    # Tenant cannot add or edit beds
    assert (
        seeded_client.post(
            "/api/beds",
            headers=bearer(tenant_tok),
            json={"room_id": room["id"], "bed_label": "C", "monthly_rent": "7000.00"},
        ).status_code
        == 403
    )


def test_7_8_9_10_11_tenant_registration_and_allocation_guards(seeded_client):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    beds = seeded_client.get("/api/beds", headers=bearer(mgr_tok)).json()
    vacant_beds = [b for b in beds if b["status"] == "vacant"]
    occupied_bed = next(b for b in beds if b["status"] == "occupied")

    # Mark one vacant bed as maintenance
    maint_bed = vacant_beds[0]
    assert (
        seeded_client.patch(
            f"/api/beds/{maint_bed['id']}/status",
            headers=bearer(mgr_tok),
            json={"status": "maintenance"},
        ).status_code
        == 200
    )
    usable_bed = vacant_beds[1]

    # 8. Invalid tenant information rejected
    bad_mobile = seeded_client.post(
        "/api/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Bad Mobile",
            "mobile": "123",
            "bed_id": usable_bed["id"],
            "monthly_rent": "7500",
            "joining_date": date.today().isoformat(),
            "emergency_contact_name": "Guardian",
            "emergency_contact_phone": "9811112222",
        },
    )
    assert bad_mobile.status_code == 422

    bad_dates = seeded_client.post(
        "/api/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Bad Date",
            "mobile": "9822223333",
            "bed_id": usable_bed["id"],
            "monthly_rent": "7500",
            "joining_date": date.today().isoformat(),
            "expected_leaving_date": (date.today() - timedelta(days=5)).isoformat(),
            "emergency_contact_name": "Guardian",
            "emergency_contact_phone": "9811112222",
        },
    )
    assert bad_dates.status_code == 422

    # 9. Occupied bed cannot be assigned again
    occ_resp = seeded_client.post(
        "/api/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Occupied Try",
            "mobile": "9822223334",
            "bed_id": occupied_bed["id"],
            "monthly_rent": "7500",
            "joining_date": date.today().isoformat(),
            "emergency_contact_name": "Guardian",
            "emergency_contact_phone": "9811112222",
        },
    )
    assert occ_resp.status_code == 409

    # 10. Maintenance bed cannot be allocated
    maint_resp = seeded_client.post(
        "/api/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Maint Try",
            "mobile": "9822223335",
            "bed_id": maint_bed["id"],
            "monthly_rent": "7500",
            "joining_date": date.today().isoformat(),
            "emergency_contact_name": "Guardian",
            "emergency_contact_phone": "9811112222",
        },
    )
    assert maint_resp.status_code == 409

    # 7 & 11. Valid tenant registration creates tenant with TENANT role securely
    ok = seeded_client.post(
        "/api/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Meera Iyer",
            "mobile": "9833334444",
            "email": "meera@example.com",
            "gender": "female",
            "date_of_birth": "2000-05-14",
            "permanent_address": "MG Road, Kochi",
            "bed_id": usable_bed["id"],
            "monthly_rent": "8000.00",
            "food_charges": "1000.00",
            "security_deposit_amount": "15000.00",
            "joining_date": date.today().isoformat(),
            "expected_leaving_date": (date.today() + timedelta(days=180)).isoformat(),
            "emergency_contact_name": "Ramesh Iyer",
            "emergency_contact_phone": "9833334445",
            "police_verification_status": "pending",
        },
    )
    assert ok.status_code == 200, ok.text
    created = ok.json()
    assert created["tenant"]["full_name"] == "Meera Iyer"
    assert created["tenant"]["permanent_address"] == "MG Road, Kochi"
    assert len(created["tenant"]["allocation_history"]) == 1
    assert created["tenant"]["allocation_history"][0]["action"] == "allocated"

    meera_tok = login_token(seeded_client, "9833334444", created["temporary_password"])
    me = seeded_client.get("/api/auth/me", headers=bearer(meera_tok)).json()
    assert me["role"] == "tenant"


def test_12_13_tenant_isolation_and_private_document_security(seeded_client):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    rahul_tok = login_token(seeded_client, "9800000003", "Tenant@123")
    neha_tok = login_token(seeded_client, "9800000004", "Tenant@123")

    tenants = seeded_client.get("/api/tenants", headers=bearer(mgr_tok)).json()
    rahul = next(t for t in tenants if t["full_name"] == "Rahul Sharma")
    neha = next(t for t in tenants if t["full_name"] == "Neha Patel")

    # 12. Tenant cannot list all tenants or view another tenant's profile/history
    assert seeded_client.get("/api/tenants", headers=bearer(rahul_tok)).status_code == 403
    assert seeded_client.get(f"/api/tenants/{neha['id']}", headers=bearer(rahul_tok)).status_code == 403
    assert seeded_client.get(f"/api/tenants/{neha['id']}/history", headers=bearer(rahul_tok)).status_code == 403

    my_profile = seeded_client.get("/api/tenants/me", headers=bearer(rahul_tok))
    assert my_profile.status_code == 200
    assert my_profile.json()["id"] == rahul["id"]

    # 13. Unauthorized users cannot upload or view private documents
    assert (
        seeded_client.post(
            f"/api/tenants/{rahul['id']}/documents",
            headers=bearer(rahul_tok),
            data={"doc_type": "id_proof"},
            files={"file": ("id.pdf", b"%PDF-1.4 test", "application/pdf")},
        ).status_code
        == 403
    )

    # Disallowed executable file extension blocked
    bad_ext = seeded_client.post(
        f"/api/tenants/{rahul['id']}/documents",
        headers=bearer(mgr_tok),
        data={"doc_type": "id_proof"},
        files={"file": ("malware.exe", b"MZ...", "application/octet-stream")},
    )
    assert bad_ext.status_code == 422

    # Valid upload by manager
    up = seeded_client.post(
        f"/api/tenants/{rahul['id']}/documents",
        headers=bearer(mgr_tok),
        data={"doc_type": "id_proof"},
        files={"file": ("pan.pdf", b"%PDF-1.4 pan-doc", "application/pdf")},
    )
    assert up.status_code == 200
    doc_url = up.json()["url"]

    assert seeded_client.get(doc_url).status_code == 401
    assert seeded_client.get(doc_url, headers=bearer(neha_tok)).status_code == 403
    assert seeded_client.get(doc_url, headers=bearer(rahul_tok)).status_code == 200
    assert seeded_client.get(doc_url, headers=bearer(mgr_tok)).status_code == 200


def test_14_15_16_17_checkout_releases_bed_preserves_history_and_deposit(seeded_client, db_session: Session):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenants = seeded_client.get("/api/tenants", headers=bearer(mgr_tok)).json()
    neha = next(t for t in tenants if t["full_name"] == "Neha Patel")

    # 14 & 15 & 16 & 17. Checkout with deduction & remarks -> releases bed to vacant
    co = seeded_client.post(
        f"/api/tenants/{neha['id']}/checkout",
        headers=bearer(mgr_tok),
        json={
            "leaving_date": date.today().isoformat(),
            "deduction_amount": "2000.00",
            "deduction_reason": "Wall repainting",
            "checkout_remarks": "Keys returned cleanly",
            "mark_bed_maintenance": False,
        },
    )
    assert co.status_code == 200, co.text
    data = co.json()
    assert data["bed_status"] == "vacant"
    assert data["deposit_held"] == "15000.00"
    assert data["deduction_amount"] == "2000.00"
    assert data["refund_amount"] == "13000.00"
    assert data["deposit_status"] == DepositStatus.PARTIALLY_REFUNDED.value
    assert data["tenant"]["status"] == TenantStatus.CHECKED_OUT.value
    assert data["tenant"]["checkout_remarks"] == "Keys returned cleanly"

    # Bed is genuinely vacant
    bed = db_session.get(Bed, neha["bed_id"])
    assert bed is not None and bed.status == BedStatus.VACANT

    # Tenant & allocation history preserved in DB
    t_row = db_session.get(Tenant, neha["id"])
    assert t_row is not None and t_row.status == TenantStatus.CHECKED_OUT
    hist = seeded_client.get(
        f"/api/tenants/{neha['id']}/history",
        headers=bearer(mgr_tok),
    ).json()
    assert any(h["action"] == "checked_out" for h in hist)

    # Deposit refund/deduction record maintained
    dep = db_session.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == neha["id"]))
    assert dep is not None
    assert str(dep.deduction_amount) == "2000.00"
    assert str(dep.refund_amount) == "13000.00"

    # Also test checkout with mark_bed_maintenance=True on Rahul
    rahul = next(t for t in tenants if t["full_name"] == "Rahul Sharma")
    co_maint = seeded_client.post(
        f"/api/tenants/{rahul['id']}/checkout",
        headers=bearer(mgr_tok),
        json={
            "leaving_date": date.today().isoformat(),
            "deduction_amount": "0.00",
            "checkout_remarks": "AC servicing needed after move-out",
            "mark_bed_maintenance": True,
        },
    )
    assert co_maint.status_code == 200
    assert co_maint.json()["bed_status"] == "maintenance"

