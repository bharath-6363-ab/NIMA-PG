from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import BedStatus, DepositStatus, TenantStatus, VacancyStatus
from app.models.finance import SecurityDeposit
from app.models.property import Bed, VacancyRecord
from tests.conftest import bearer, login_token


def test_tenant_registration_duplicate_bed_prevention_docs_and_checkout(seeded_client, db_session: Session):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")

    rooms_resp = seeded_client.get("/api/v1/manager/rooms", headers=bearer(mgr_tok))
    assert rooms_resp.status_code == 200
    rooms = rooms_resp.json()

    vacant_bed = next(
        bed
        for r in rooms
        for bed in r["beds"]
        if bed["status"] == "vacant"
    )
    occupied_bed = next(
        bed
        for r in rooms
        for bed in r["beds"]
        if bed["status"] == "occupied"
    )

    # Duplicate / occupied bed allocation must fail with 409 Conflict
    dup_resp = seeded_client.post(
        "/api/v1/manager/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Duplicate Attempt",
            "mobile": "9812345670",
            "bed_id": occupied_bed["id"],
            "monthly_rent": "8000.00",
            "food_charges": "1000.00",
            "security_deposit_amount": "15000.00",
            "joining_date": date.today().isoformat(),
            "emergency_contact_name": "Parent",
            "emergency_contact_phone": "9812345671",
        },
    )
    assert dup_resp.status_code == 409

    # Valid onboarding on vacant bed
    create_resp = seeded_client.post(
        "/api/v1/manager/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Priya Nair",
            "mobile": "9812345678",
            "email": "priya@example.com",
            "gender": "female",
            "bed_id": vacant_bed["id"],
            "monthly_rent": "8000.00",
            "food_charges": "1000.00",
            "security_deposit_amount": "16000.00",
            "joining_date": date.today().isoformat(),
            "emergency_contact_name": "Suresh Nair",
            "emergency_contact_phone": "9812345679",
            "police_verification_status": "submitted",
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    created_data = create_resp.json()
    tenant_id = created_data["tenant"]["id"]
    temp_pw = created_data["temporary_password"]
    assert created_data["account_created"] is True
    assert temp_pw

    # Bed automatically marked occupied
    bed_obj = db_session.get(Bed, vacant_bed["id"])
    assert bed_obj is not None
    assert bed_obj.status == BedStatus.OCCUPIED

    # Second attempt on same bed fails
    dup_after = seeded_client.post(
        "/api/v1/manager/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Another Person",
            "mobile": "9812345699",
            "bed_id": vacant_bed["id"],
            "monthly_rent": "8000.00",
            "food_charges": "1000.00",
            "security_deposit_amount": "16000.00",
            "joining_date": date.today().isoformat(),
            "emergency_contact_name": "Parent",
            "emergency_contact_phone": "9812345698",
        },
    )
    assert dup_after.status_code == 409

    # Upload tenant ID proof & verify tenant isolation on file download
    doc_resp = seeded_client.post(
        f"/api/v1/manager/tenants/{tenant_id}/documents",
        headers=bearer(mgr_tok),
        data={"doc_type": "id_proof"},
        files={"file": ("aadhaar.pdf", b"%PDF-1.4 dummy-id", "application/pdf")},
    )
    assert doc_resp.status_code == 200
    doc_url = doc_resp.json()["url"]

    priya_tok = login_token(seeded_client, "9812345678", temp_pw)
    rahul_tok = login_token(seeded_client, "9800000003", "Tenant@123")
    assert seeded_client.get(doc_url, headers=bearer(priya_tok)).status_code == 200
    assert seeded_client.get(doc_url, headers=bearer(mgr_tok)).status_code == 200
    assert seeded_client.get(doc_url, headers=bearer(rahul_tok)).status_code == 403

    # Tenant checkout: leaving date, refundable deposit calculation, automatic vacancy update
    checkout_resp = seeded_client.post(
        f"/api/v1/manager/tenants/{tenant_id}/checkout",
        headers=bearer(mgr_tok),
        json={
            "leaving_date": date.today().isoformat(),
            "deduction_amount": "1500.00",
            "deduction_reason": "Deep cleaning & key replacement",
        },
    )
    assert checkout_resp.status_code == 200, checkout_resp.text
    co = checkout_resp.json()
    assert co["bed_status"] == "vacant"
    assert co["refund_amount"] == "14500.00"
    assert co["deposit_status"] == DepositStatus.PARTIALLY_REFUNDED.value
    assert co["tenant"]["status"] == TenantStatus.CHECKED_OUT.value

    db_session.refresh(bed_obj)
    assert bed_obj.status == BedStatus.VACANT
    assert bed_obj.vacant_since is not None

    open_vr = db_session.scalar(
        select(VacancyRecord).where(
            VacancyRecord.bed_id == bed_obj.id,
            VacancyRecord.status == VacancyStatus.OPEN,
        )
    )
    assert open_vr is not None
    assert open_vr.previous_tenant_id == tenant_id

    # Owner vacancy dashboard reflects bed automatically vacant again
    vac_dash = seeded_client.get("/api/v1/owner/vacancy", headers=bearer(owner_tok)).json()
    freed_bed = next(b for b in vac_dash["beds"] if b["id"] == vacant_bed["id"])
    assert freed_bed["status"] == "vacant"

    # Security deposit record preserved
    dep = db_session.scalar(select(SecurityDeposit).where(SecurityDeposit.tenant_id == tenant_id))
    assert dep is not None
    assert str(dep.refund_amount) == "14500.00"

