from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.enums import BedStatus, GenderPolicy, SharingType, TenantStatus, UserRole
from app.models.property import Bed, PGProperty, Room
from tests.conftest import bearer, login_token


def test_phase6_owner_dashboard_metrics_filters_and_activity(seeded_client, db_session: Session):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    today = date.today()
    prev_month = 12 if today.month == 1 else today.month - 1
    prev_year = today.year - 1 if today.month == 1 else today.year

    # 1. Current month metrics from real seeded DB
    dash = seeded_client.get(
        "/api/owner/finance/dashboard",
        headers=bearer(owner_tok),
        params={"month": today.month, "year": today.year},
    )
    assert dash.status_code == 200, dash.text
    d = dash.json()
    assert d["total_expected_rent"] == "25500.00"
    assert d["total_collected_rent"] == "8500.00"
    assert d["total_pending_rent"] == "17000.00"
    # Security deposit must be tracked separately from collected rent (3 * 15000 = 45000)
    assert d["total_security_deposits_held"] == "45000.00"
    assert d["total_active_tenants"] == 3
    assert d["paid_tenants_count"] == 1
    assert d["pending_tenants_count"] == 2
    assert d["total_properties"] == 1
    assert d["total_rooms"] == 5
    assert d["total_beds"] == 9
    assert d["occupied_beds"] == 3
    assert d["vacant_beds"] == 6
    assert d["occupancy_percentage"] == 33.3
    assert len(d["recently_registered_tenants"]) == 3
    assert len(d["recent_complaints"]) >= 2
    assert len(d["recent_activity"]) >= 3

    # 2. Previous month filter matches seeded historical payments (3/3 paid)
    prev_dash = seeded_client.get(
        "/api/owner/finance/dashboard",
        headers=bearer(owner_tok),
        params={"month": prev_month, "year": prev_year},
    )
    assert prev_dash.status_code == 200
    assert prev_dash.json()["paid_tenants_count"] == 3
    assert prev_dash.json()["total_pending_rent"] == "0.00"

    # 3. Custom date range validation & filtering
    bad_range = seeded_client.get(
        "/api/owner/finance/dashboard",
        headers=bearer(owner_tok),
        params={"start_date": "2026-05-10", "end_date": "2026-05-01"},
    )
    assert bad_range.status_code == 422

    custom_range = seeded_client.get(
        "/api/owner/finance/dashboard",
        headers=bearer(owner_tok),
        params={
            "start_date": (today - timedelta(days=45)).isoformat(),
            "end_date": (today + timedelta(days=15)).isoformat(),
        },
    )
    assert custom_range.status_code == 200
    assert Decimal(custom_range.json()["total_collected_rent"]) >= Decimal("8500.00")


def test_phase6_financial_reports_search_and_exports(seeded_client):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    today = date.today()

    # 1. Full structured reports payload
    rep = seeded_client.get(
        "/api/owner/finance/reports-data",
        headers=bearer(owner_tok),
        params={"month": today.month, "year": today.year},
    )
    assert rep.status_code == 200, rep.text
    r = rep.json()
    assert r["total_expected_rent"] == "25500.00"
    assert r["total_collected_rent"] == "8500.00"
    assert r["total_security_deposits_held"] == "45000.00"
    assert r["collection_rate_percentage"] == 33.3
    assert len(r["monthly_collection_rows"]) == 3
    assert len(r["pending_rent_rows"]) == 2
    assert len(r["payment_history_rows"]) >= 1
    assert len(r["security_deposit_rows"]) == 3

    # 2. Search filtering isolates specific tenant rows
    filtered = seeded_client.get(
        "/api/owner/finance/reports-data",
        headers=bearer(owner_tok),
        params={"month": today.month, "year": today.year, "search": "Neha"},
    ).json()
    assert len(filtered["monthly_collection_rows"]) == 1
    assert filtered["monthly_collection_rows"][0]["tenant_name"] == "Neha Patel"

    # 3. Export CSV & PDF for each report_type (pending, payments, deposits)
    for rtype in ("collection", "pending", "payments", "deposits"):
        csv_res = seeded_client.get(
            "/api/owner/finance/report",
            headers=bearer(owner_tok),
            params={"month": today.month, "year": today.year, "fmt": "csv", "report_type": rtype},
        )
        assert csv_res.status_code == 200
        assert "Aapka PG Residences" in csv_res.text

        pdf_res = seeded_client.get(
            "/api/owner/finance/report",
            headers=bearer(owner_tok),
            params={"month": today.month, "year": today.year, "fmt": "pdf", "report_type": rtype},
        )
        assert pdf_res.status_code == 200
        assert pdf_res.content.startswith(b"%PDF-1.4")


def test_phase6_vacancy_transitions_checkout_and_public_privacy(
    seeded_client, db_session: Session
):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")

    vac_resp = seeded_client.get("/api/vacancy", headers=bearer(mgr_tok))
    assert vac_resp.status_code == 200, vac_resp.text
    vac_data = vac_resp.json()
    assert vac_data["vacant_beds"] == 6
    assert vac_data["share_links"] == []  # Managers do not receive owner share link tools

    # 1. Manager toggles bed maintenance status & public visibility
    vacant_bed = next(b for b in vac_data["beds"] if b["status"] == "vacant")
    occupied_bed = next(b for b in vac_data["beds"] if b["status"] == "occupied")

    # Cannot mark occupied bed under maintenance before checkout
    bad_maint = seeded_client.patch(
        f"/api/vacancy/beds/{occupied_bed['id']}",
        headers=bearer(mgr_tok),
        json={"status": "maintenance"},
    )
    assert bad_maint.status_code == 409

    # Mark a vacant bed hidden from public listing AND move another vacant bed to maintenance
    hide_bed = seeded_client.patch(
        f"/api/vacancy/beds/{vacant_bed['id']}",
        headers=bearer(mgr_tok),
        json={"is_publicly_available": False},
    )
    assert hide_bed.status_code == 200
    assert hide_bed.json()["is_publicly_available"] is False

    second_vacant = [b for b in vac_data["beds"] if b["status"] == "vacant"][1]
    to_maint = seeded_client.patch(
        f"/api/vacancy/beds/{second_vacant['id']}",
        headers=bearer(mgr_tok),
        json={"status": "maintenance"},
    )
    assert to_maint.status_code == 200
    assert to_maint.json()["status"] == "maintenance"

    # 2. Owner creates share link -> public listing hides hidden/maintenance beds & zero tenant PII
    share = seeded_client.post(
        "/api/owner/vacancy/share-links",
        headers=bearer(owner_tok),
        json={"title": "Verified Beds Only", "expires_in_days": 10},
    )
    assert share.status_code == 200
    token = share.json()["token"]

    pub = seeded_client.get(f"/api/public/vacancy/{token}")
    assert pub.status_code == 200
    p_data = pub.json()
    # Initially 6 vacant beds minus 1 hidden minus 1 maintenance = 4 publicly listed beds!
    assert p_data["vacant_beds_count"] == 4
    pub_codes = {b["bed_code"] for b in p_data["available_beds"]}
    assert vacant_bed["bed_code"] not in pub_codes
    assert second_vacant["bed_code"] not in pub_codes
    assert "Rahul Sharma" not in pub.text
    assert "9800000003" not in pub.text

    # Public directory lists only PG with active share link
    dir_resp = seeded_client.get("/api/public/vacancies")
    assert dir_resp.status_code == 200
    assert len(dir_resp.json()) == 1
    assert dir_resp.json()[0]["vacant_beds_count"] == 4

    # Restore bed from maintenance -> becomes vacant & counts in public availability again
    restore_vac = seeded_client.patch(
        f"/api/vacancy/beds/{second_vacant['id']}",
        headers=bearer(mgr_tok),
        json={"status": "vacant"},
    )
    assert restore_vac.status_code == 200
    assert restore_vac.json()["status"] == "vacant"

    # 3. Tenant checkout automatically frees bed to Vacant (unless marked maintenance)
    tenants = seeded_client.get("/api/tenants", headers=bearer(mgr_tok)).json()
    target_tenant = next(t for t in tenants if t["bed_id"] == occupied_bed["id"])
    co = seeded_client.post(
        f"/api/tenants/{target_tenant['id']}/checkout",
        headers=bearer(mgr_tok),
        json={
            "leaving_date": date.today().isoformat(),
            "deduction_amount": "0.00",
            "mark_bed_maintenance": False,
        },
    )
    assert co.status_code == 200
    assert co.json()["bed_status"] == "vacant"

    # Owner dashboard recent checkouts reflects the completed checkout
    dash_after = seeded_client.get("/api/owner/finance/dashboard", headers=bearer(owner_tok)).json()
    assert any(c["full_name"] == target_tenant["full_name"] for c in dash_after["recent_checkouts"])


def test_phase6_rbac_and_multi_property_scoping(seeded_client, db_session: Session):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    # 1. Tenant blocked from owner dashboard, reports, and internal vacancy management
    assert seeded_client.get("/api/owner/finance/dashboard", headers=bearer(tenant_tok)).status_code == 403
    assert seeded_client.get("/api/owner/finance/reports-data", headers=bearer(tenant_tok)).status_code == 403
    assert seeded_client.get("/api/owner/finance/report", headers=bearer(tenant_tok)).status_code == 403
    assert seeded_client.get("/api/vacancy", headers=bearer(tenant_tok)).status_code == 403

    # 2. Manager blocked from owner dashboard, financial reports & share link creation
    assert seeded_client.get("/api/owner/finance/dashboard", headers=bearer(mgr_tok)).status_code == 403
    assert seeded_client.get("/api/owner/finance/reports-data", headers=bearer(mgr_tok)).status_code == 403
    assert seeded_client.get("/api/owner/vacancy", headers=bearer(mgr_tok)).status_code == 403
    assert (
        seeded_client.post(
            "/api/owner/vacancy/share-links",
            headers=bearer(mgr_tok),
            json={"title": "Blocked"},
        ).status_code
        == 403
    )

    # 3. Create a second property for the Owner -> Owner can filter by pg_id, Manager is blocked from it
    owner_user = db_session.query(PGProperty).first()
    assert owner_user is not None
    pg2 = PGProperty(
        owner_id=owner_user.owner_id,
        name="Aapka PG Koramangala",
        address="80 Feet Road",
        city="Bengaluru",
        gender_policy=GenderPolicy.FEMALE,
    )
    db_session.add(pg2)
    db_session.flush()
    r2 = Room(
        pg_id=pg2.id,
        room_number="K1",
        floor="1st Floor",
        sharing_type=SharingType.SINGLE,
        max_capacity=1,
        base_rent=Decimal("12000.00"),
    )
    db_session.add(r2)
    db_session.flush()
    db_session.add(
        Bed(
            pg_id=pg2.id,
            room_id=r2.id,
            bed_label="A",
            bed_code="K1-A",
            status=BedStatus.VACANT,
            monthly_rent=Decimal("12000.00"),
        )
    )
    db_session.commit()

    dash_pg2 = seeded_client.get(
        "/api/owner/finance/dashboard",
        headers=bearer(owner_tok),
        params={"pg_id": pg2.id},
    )
    assert dash_pg2.status_code == 200
    assert dash_pg2.json()["pg_name"] == "Aapka PG Koramangala"
    assert dash_pg2.json()["total_properties"] == 2
    assert dash_pg2.json()["vacant_beds"] == 1

    # Manager assigned to PG 1 cannot view PG 2 vacancies
    mgr_pg2 = seeded_client.get(
        "/api/vacancy",
        headers=bearer(mgr_tok),
        params={"pg_id": pg2.id},
    )
    assert mgr_pg2.status_code == 403

