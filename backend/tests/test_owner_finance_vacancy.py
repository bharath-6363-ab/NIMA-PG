from datetime import date

from tests.conftest import bearer, login_token


def test_owner_finance_reports_reminders_vacancy_links_and_manager_crud(seeded_client):
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    neha_tok = login_token(seeded_client, "9800000004", "Tenant@123")

    today = date.today()
    # Financial dashboard from real DB records (3 tenants x 8500 = 25500 expected; Rahul paid 8500; 2 pending = 17000)
    fin = seeded_client.get(
        "/api/v1/owner/finance/dashboard",
        headers=bearer(owner_tok),
        params={"month": today.month, "year": today.year},
    )
    assert fin.status_code == 200, fin.text
    f_data = fin.json()
    assert f_data["total_expected_rent"] == "25500.00"
    assert f_data["total_collected_rent"] == "8500.00"
    assert f_data["total_pending_rent"] == "17000.00"
    assert f_data["paid_tenants_count"] == 1
    assert f_data["pending_tenants_count"] == 2
    assert f_data["total_security_deposits_held"] == "45000.00"
    assert len(f_data["monthly_trend"]) == 6

    # Manager must be blocked from owner financial dashboard & settings
    assert seeded_client.get("/api/v1/owner/finance/dashboard", headers=bearer(mgr_tok)).status_code == 403
    assert seeded_client.get("/api/v1/owner/managers", headers=bearer(mgr_tok)).status_code == 403

    # Send rent reminder to Neha
    neha_pending = next(r for r in f_data["pending_tenants"] if "Neha" in r["tenant_name"])
    rem = seeded_client.post(
        f"/api/v1/owner/finance/reminders/{neha_pending['rent_record_id']}",
        headers=bearer(owner_tok),
    )
    assert rem.status_code == 200
    assert "wa.me" in rem.json()["whatsapp_url"]

    neha_notifs = seeded_client.get("/api/v1/tenant/notifications", headers=bearer(neha_tok)).json()
    assert any(n["notif_type"] == "rent_reminder" for n in neha_notifs)

    # Individual tenant history
    t_hist = seeded_client.get(
        f"/api/v1/owner/finance/tenants/{neha_pending['tenant_id']}/history",
        headers=bearer(owner_tok),
    )
    assert t_hist.status_code == 200
    assert t_hist.json()["full_name"] == "Neha Patel"

    # Download CSV and PDF monthly financial reports
    csv_rep = seeded_client.get(
        "/api/v1/owner/finance/report",
        headers=bearer(owner_tok),
        params={"month": today.month, "year": today.year, "fmt": "csv"},
    )
    assert csv_rep.status_code == 200
    assert "Neha Patel" in csv_rep.text
    assert "25500.00" in csv_rep.text

    pdf_rep = seeded_client.get(
        "/api/v1/owner/finance/report",
        headers=bearer(owner_tok),
        params={"month": today.month, "year": today.year, "fmt": "pdf"},
    )
    assert pdf_rep.status_code == 200
    assert pdf_rep.content.startswith(b"%PDF-1.4")

    # Vacancy dashboard + shareable public link exposing ZERO tenant PII
    vac = seeded_client.get("/api/v1/owner/vacancy", headers=bearer(owner_tok))
    assert vac.status_code == 200
    v_data = vac.json()
    assert v_data["total_rooms"] == 5
    assert v_data["total_beds"] == 9
    assert v_data["vacant_beds"] == 6
    assert any(b["days_vacant"] >= 12 for b in v_data["beds"] if b["status"] == "vacant")

    share_resp = seeded_client.post(
        "/api/v1/owner/vacancy/share-links",
        headers=bearer(owner_tok),
        json={"title": "November Vacancies", "expires_in_days": 15},
    )
    assert share_resp.status_code == 200
    share_token = share_resp.json()["token"]
    share_id = share_resp.json()["id"]

    # Unauthenticated public endpoint must expose vacant/notice beds and NEVER tenant names or mobiles
    pub_resp = seeded_client.get(f"/api/v1/public/vacancy/{share_token}")
    assert pub_resp.status_code == 200
    pub_text = pub_resp.text
    assert "Rahul Sharma" not in pub_text
    assert "Neha Patel" not in pub_text
    assert "9800000003" not in pub_text
    assert pub_resp.json()["vacant_beds_count"] == 6

    # Revoke link -> public endpoint returns 404
    rev = seeded_client.delete(
        f"/api/v1/owner/vacancy/share-links/{share_id}",
        headers=bearer(owner_tok),
    )
    assert rev.status_code == 200
    assert seeded_client.get(f"/api/v1/public/vacancy/{share_token}").status_code == 404

    # Owner Manager CRUD + Settings + Room Creation
    new_mgr = seeded_client.post(
        "/api/v1/owner/managers",
        headers=bearer(owner_tok),
        json={
            "full_name": "Karan Night Manager",
            "mobile": "9800000099",
            "email": "karan@aapkapg.com",
            "password": "Karan@123",
        },
    )
    assert new_mgr.status_code == 200
    new_mgr_id = new_mgr.json()["id"]

    new_mgr_tok = login_token(seeded_client, "9800000099", "Karan@123")
    assert seeded_client.get("/api/v1/manager/overview", headers=bearer(new_mgr_tok)).status_code == 200

    # Remove manager -> access immediately revoked
    del_mgr = seeded_client.delete(
        f"/api/v1/owner/managers/{new_mgr_id}",
        headers=bearer(owner_tok),
    )
    assert del_mgr.status_code == 200
    assert seeded_client.get("/api/v1/manager/overview", headers=bearer(new_mgr_tok)).status_code == 401

    # PG Settings & New Room creation
    pg_upd = seeded_client.put(
        "/api/v1/owner/pg",
        headers=bearer(owner_tok),
        json={"rent_due_day": 7, "city": "Bengaluru"},
    )
    assert pg_upd.status_code == 200
    assert pg_upd.json()["rent_due_day"] == 7

    new_room = seeded_client.post(
        "/api/v1/owner/rooms",
        headers=bearer(owner_tok),
        json={
            "room_number": "301",
            "floor": "3rd Floor",
            "sharing_type": "double",
            "base_rent": "8500.00",
        },
    )
    assert new_room.status_code == 200
    assert len(new_room.json()["beds"]) == 2
