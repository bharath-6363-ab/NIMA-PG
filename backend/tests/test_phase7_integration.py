from datetime import date, timedelta
from decimal import Decimal
import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models.complaint import Complaint, ComplaintImage
from app.models.enums import (
    BedStatus,
    ComplaintCategory,
    ComplaintStatus,
    DayOfWeek,
    DocumentType,
    GenderPolicy,
    MealType,
    SharingType,
    TenantStatus,
    UserRole,
)
from app.models.food import FoodMenu
from app.models.property import Bed, PGProperty, Room
from app.models.tenant import Tenant, TenantDocument
from app.models.user import User
from tests.conftest import bearer

# Minimal valid 1x1 PNG bytes for multipart image/document upload checks
MINIMAL_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc`\x00\x00"
    b"\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _api_login(client: TestClient, mobile: str, password: str, portal_role: str | None = None) -> str:
    payload: dict[str, str] = {"mobile": mobile, "password": password}
    if portal_role is not None:
        payload["portal_role"] = portal_role
    resp = client.post("/api/auth/login", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def test_phase7_full_pg_lifecycle_e2e(seeded_client: TestClient) -> None:
    """Verify full cross-phase workflow from Auth -> PG Settings -> Rooms/Tenants ->
    Rent/Receipts -> Complaints/Food -> Owner Dashboard/Reports/Vacancy -> Checkout."""

    # ------------------------------------------------------------------
    # 1. Authentication, Role Isolation & Token Revocation
    # ------------------------------------------------------------------
    owner_token = _api_login(seeded_client, "9800000001", "Owner@123", portal_role="owner")
    manager_token = _api_login(seeded_client, "9800000002", "Manager@123", portal_role="manager")
    other_tenant_token = _api_login(seeded_client, "9800000003", "Tenant@123", portal_role="tenant")

    # Manager and Tenant cannot access Owner-only endpoints
    assert seeded_client.get("/api/owner/pg", headers=bearer(manager_token)).status_code == 403
    assert seeded_client.get("/api/owner/pg", headers=bearer(other_tenant_token)).status_code == 403
    assert (
        seeded_client.get("/api/owner/finance/dashboard", headers=bearer(manager_token)).status_code
        == 403
    )
    assert (
        seeded_client.post(
            "/api/owner/managers",
            headers=bearer(manager_token),
            json={
                "full_name": "Unauthorized",
                "mobile": "9811112222",
                "password": "Password@123",
            },
        ).status_code
        == 403
    )

    # Logout must immediately revoke the active token
    temp_token = _api_login(seeded_client, "9800000002", "Manager@123")
    assert seeded_client.get("/api/auth/me", headers=bearer(temp_token)).status_code == 200
    assert seeded_client.post("/api/auth/logout", headers=bearer(temp_token)).status_code == 200
    assert seeded_client.get("/api/auth/me", headers=bearer(temp_token)).status_code == 401

    # ------------------------------------------------------------------
    # 2. Owner PG Property Settings (GET & PUT /api/owner/pg)
    # ------------------------------------------------------------------
    pg_resp = seeded_client.get("/api/owner/pg", headers=bearer(owner_token))
    assert pg_resp.status_code == 200, pg_resp.text
    pg_data = pg_resp.json()

    pg_update = seeded_client.put(
        "/api/owner/pg",
        headers=bearer(owner_token),
        json={
            "rent_due_day": 7,
            "breakfast_timing": "07:45 AM - 09:45 AM",
            "amenities": f"{pg_data['amenities']}, Reading Lounge",
        },
    )
    assert pg_update.status_code == 200, pg_update.text
    assert pg_update.json()["rent_due_day"] == 7
    assert "Reading Lounge" in pg_update.json()["amenities"]

    # ------------------------------------------------------------------
    # 3. Room & Bed Creation + Tenant Onboarding + KYC Document Isolation
    # ------------------------------------------------------------------
    room_resp = seeded_client.post(
        "/api/rooms",
        headers=bearer(owner_token),
        json={
            "room_number": "701",
            "floor": "7th Floor",
            "sharing_type": "double",
            "max_capacity": 2,
            "description": "Phase 7 E2E corner double room",
            "base_rent": 9000,
            "food_charges": 2000,
            "auto_create_beds": True,
        },
    )
    assert room_resp.status_code == 200, room_resp.text
    room = room_resp.json()
    assert len(room["beds"]) == 2
    bed_a = room["beds"][0]
    bed_b = room["beds"][1]

    today = date.today()
    month_start = today.replace(day=1)

    onboard_resp = seeded_client.post(
        "/api/tenants",
        headers=bearer(manager_token),
        json={
            "full_name": "Karan Mehta",
            "mobile": "9876543219",
            "email": "karan.e2e@example.com",
            "gender": "male",
            "bed_id": bed_a["id"],
            "monthly_rent": 9000,
            "food_charges": 2000,
            "security_deposit_amount": 10000,
            "joining_date": month_start.isoformat(),
            "emergency_contact_name": "Rajesh Mehta",
            "emergency_contact_phone": "9876500001",
            "password": "Tenant@789",
        },
    )
    assert onboard_resp.status_code == 200, onboard_resp.text
    tenant_info = onboard_resp.json()["tenant"]
    tenant_id = tenant_info["id"]
    assert tenant_info["bed_code"] == bed_a["bed_code"]

    # Safe-delete guard: cannot delete room while a bed is occupied
    del_room_resp = seeded_client.delete(
        f"/api/rooms/{room['id']}", headers=bearer(owner_token)
    )
    assert del_room_resp.status_code in (400, 409, 422), del_room_resp.text

    # Upload KYC document and verify strict protected-file access control
    doc_resp = seeded_client.post(
        f"/api/tenants/{tenant_id}/documents",
        headers=bearer(manager_token),
        data={"doc_type": DocumentType.ID_PROOF.value},
        files={"file": ("kyc_id.png", MINIMAL_PNG, "image/png")},
    )
    assert doc_resp.status_code == 200, doc_resp.text
    doc_id = doc_resp.json()["id"]

    new_tenant_token = _api_login(seeded_client, "9876543219", "Tenant@789", portal_role="tenant")
    assert (
        seeded_client.get(f"/api/files/tenant-docs/{doc_id}", headers=bearer(new_tenant_token)).status_code
        == 200
    )
    assert (
        seeded_client.get(f"/api/files/tenant-docs/{doc_id}", headers=bearer(owner_token)).status_code
        == 200
    )
    assert (
        seeded_client.get(f"/api/files/tenant-docs/{doc_id}", headers=bearer(other_tenant_token)).status_code
        == 403
    )

    # ------------------------------------------------------------------
    # 4. Rent Generation, Duplicate Guard, Offline Payment & PDF Receipt
    # ------------------------------------------------------------------
    # Current month rent is auto-generated at onboarding; calling generate is idempotent
    gen_curr = seeded_client.post(
        "/api/rent/generate",
        headers=bearer(manager_token),
        json={"billing_month": today.month, "billing_year": today.year},
    )
    assert gen_curr.status_code == 200, gen_curr.text
    assert gen_curr.json()["skipped_existing_count"] >= 1

    # Batch generation for next billing month creates new rent records once, then skips duplicates
    next_month = 1 if today.month == 12 else today.month + 1
    next_year = today.year + 1 if today.month == 12 else today.year

    gen1 = seeded_client.post(
        "/api/rent/generate",
        headers=bearer(manager_token),
        json={"billing_month": next_month, "billing_year": next_year},
    )
    assert gen1.status_code == 200, gen1.text
    assert gen1.json()["created_count"] >= 1

    gen2 = seeded_client.post(
        "/api/rent/generate",
        headers=bearer(manager_token),
        json={"billing_month": next_month, "billing_year": next_year},
    )
    assert gen2.status_code == 200, gen2.text
    assert gen2.json()["created_count"] == 0
    assert gen2.json()["skipped_existing_count"] >= 1

    my_rent_before = seeded_client.get("/api/rent/my", headers=bearer(new_tenant_token))
    assert my_rent_before.status_code == 200, my_rent_before.text
    rent_rec = my_rent_before.json()["current_rent"]
    assert rent_rec is not None
    rent_record_id = rent_rec["id"]
    total_payable = Decimal(str(rent_rec["total_amount"]))
    half_amount = (total_payable / Decimal("2")).quantize(Decimal("0.01"))
    rest_amount = total_payable - half_amount

    pay1 = seeded_client.post(
        "/api/payments/offline",
        headers=bearer(manager_token),
        json={
            "rent_record_id": rent_record_id,
            "amount": float(half_amount),
            "payment_method": "upi",
            "transaction_ref": "UPI-PH7-001",
            "notes": "First installment",
        },
    )
    assert pay1.status_code == 200, pay1.text

    rent_mid = seeded_client.get("/api/rent/my", headers=bearer(new_tenant_token)).json()["current_rent"]
    expected_mid_status = (
        "overdue" if date.fromisoformat(rent_mid["due_date"]) < today else "partial"
    )
    assert rent_mid["status"] == expected_mid_status
    assert Decimal(str(rent_mid["amount_paid"])) == half_amount
    assert Decimal(str(rent_mid["balance_due"])) == rest_amount

    pay2 = seeded_client.post(
        "/api/payments/offline",
        headers=bearer(owner_token),
        json={
            "rent_record_id": rent_record_id,
            "amount": float(rest_amount),
            "payment_method": "cash",
            "notes": "Final installment",
        },
    )
    assert pay2.status_code == 200, pay2.text
    payment_id = pay2.json()["id"]

    rent_paid = seeded_client.get("/api/rent/my", headers=bearer(new_tenant_token)).json()["current_rent"]
    assert rent_paid["status"] == "paid"
    assert Decimal(str(rent_paid["balance_due"])) == Decimal("0.00")

    pdf_resp = seeded_client.get(
        f"/api/receipts/{payment_id}/download", headers=bearer(new_tenant_token)
    )
    assert pdf_resp.status_code == 200
    assert pdf_resp.headers["content-type"].startswith("application/pdf")
    assert pdf_resp.content[:4] == b"%PDF"

    # ------------------------------------------------------------------
    # 5. Tenant Complaints (plumbing) + Image Isolation + Status + Rating
    # ------------------------------------------------------------------
    comp_resp = seeded_client.post(
        "/api/complaints",
        headers=bearer(new_tenant_token),
        data={
            "category": ComplaintCategory.PLUMBING.value,
            "title": "Washbasin tap leaking in Room 701",
            "description": "Steady drip since morning near shared sink.",
        },
        files={"image": ("leak.png", MINIMAL_PNG, "image/png")},
    )
    assert comp_resp.status_code == 200, comp_resp.text
    comp = comp_resp.json()
    comp_id = comp["id"]
    img_id = comp["images"][0]["id"]
    assert comp["category"] == "plumbing"
    assert comp["status"] == "submitted"

    assert (
        seeded_client.get(
            f"/api/files/complaint-images/{img_id}", headers=bearer(new_tenant_token)
        ).status_code
        == 200
    )
    assert (
        seeded_client.get(
            f"/api/files/complaint-images/{img_id}", headers=bearer(owner_token)
        ).status_code
        == 200
    )
    assert (
        seeded_client.get(
            f"/api/files/complaint-images/{img_id}", headers=bearer(other_tenant_token)
        ).status_code
        == 403
    )

    st_prog = seeded_client.patch(
        f"/api/complaints/{comp_id}/status",
        headers=bearer(manager_token),
        json={"status": "in_progress", "remarks": "Plumber assigned for evening visit."},
    )
    assert st_prog.status_code == 200
    assert st_prog.json()["status"] == "in_progress"

    st_done = seeded_client.patch(
        f"/api/complaints/{comp_id}/status",
        headers=bearer(manager_token),
        json={"status": "resolved", "remarks": "Replaced washer and tested tap."},
    )
    assert st_done.status_code == 200
    assert st_done.json()["status"] == "resolved"

    rate_resp = seeded_client.post(
        f"/api/complaints/{comp_id}/rate",
        headers=bearer(new_tenant_token),
        json={"rating": 5, "feedback": "Quick repair."},
    )
    assert rate_resp.status_code == 200, rate_resp.text
    assert rate_resp.json()["tenant_rating"] == 5

    # ------------------------------------------------------------------
    # 6. Weekly Food Menu, Meal Image, Future Skip, Duplicate Guard & Rent Unchanged
    # ------------------------------------------------------------------
    rent_total_before_food = Decimal(str(rent_paid["total_amount"]))

    menu_upsert = seeded_client.put(
        "/api/food/menu",
        headers=bearer(manager_token),
        json={
            "slots": [
                {
                    "day_of_week": DayOfWeek.MONDAY.value,
                    "meal_type": MealType.LUNCH.value,
                    "meal_name": "Rajma Chawal & Raita",
                    "description": "Homestyle kidney beans with steamed rice",
                    "timing_label": "12:30 PM - 02:30 PM",
                    "is_available": True,
                    "is_published": False,
                }
            ]
        },
    )
    assert menu_upsert.status_code == 200, menu_upsert.text
    menu_id = menu_upsert.json()[0]["id"]

    food_img_resp = seeded_client.post(
        f"/api/food/menu/{menu_id}/image",
        headers=bearer(manager_token),
        files={"file": ("rajma.png", MINIMAL_PNG, "image/png")},
    )
    assert food_img_resp.status_code == 200, food_img_resp.text

    pub_resp = seeded_client.post(
        "/api/food/menu/publish",
        headers=bearer(manager_token),
        json={"is_published": True},
    )
    assert pub_resp.status_code == 200, pub_resp.text

    assert (
        seeded_client.get(
            f"/api/files/food-images/{menu_id}", headers=bearer(new_tenant_token)
        ).status_code
        == 200
    )

    future_day = (today + timedelta(days=2)).isoformat()
    skip_resp = seeded_client.post(
        "/api/food/skips",
        headers=bearer(new_tenant_token),
        json={"skip_date": future_day, "meal_type": "lunch", "reason": "Office team lunch"},
    )
    assert skip_resp.status_code == 200, skip_resp.text

    dup_skip = seeded_client.post(
        "/api/food/skips",
        headers=bearer(new_tenant_token),
        json={"skip_date": future_day, "meal_type": "lunch", "reason": "Duplicate"},
    )
    assert dup_skip.status_code in (409, 422), dup_skip.text

    food_rate = seeded_client.post(
        "/api/food/ratings",
        headers=bearer(new_tenant_token),
        json={"meal_date": today.isoformat(), "meal_type": "breakfast", "rating": 4, "comment": "Fresh"},
    )
    assert food_rate.status_code == 200, food_rate.text

    rent_after_food = seeded_client.get("/api/rent/my", headers=bearer(new_tenant_token)).json()["current_rent"]
    assert Decimal(str(rent_after_food["total_amount"])) == rent_total_before_food

    # ------------------------------------------------------------------
    # 7. Owner Dashboard, Reports, Vacancy Toggle & Public Privacy
    # ------------------------------------------------------------------
    dash_resp = seeded_client.get(
        f"/api/owner/finance/dashboard?month={today.month}&year={today.year}",
        headers=bearer(owner_token),
    )
    assert dash_resp.status_code == 200, dash_resp.text
    dash = dash_resp.json()
    assert Decimal(str(dash["total_collected_rent"])) >= total_payable

    rep_csv = seeded_client.get(
        f"/api/owner/finance/report?month={today.month}&year={today.year}&fmt=csv&report_type=collection",
        headers=bearer(owner_token),
    )
    assert rep_csv.status_code == 200
    assert "Karan Mehta" in rep_csv.text

    # Hide vacant Bed 701-B from public vacancy and create a share link
    hide_resp = seeded_client.patch(
        f"/api/vacancy/beds/{bed_b['id']}",
        headers=bearer(owner_token),
        json={"is_publicly_available": False},
    )
    assert hide_resp.status_code == 200, hide_resp.text

    link_resp = seeded_client.post(
        "/api/owner/vacancy/share-links",
        headers=bearer(owner_token),
        json={"title": "Phase 7 Share Link", "expires_in_days": 15},
    )
    assert link_resp.status_code == 200, link_resp.text
    token = link_resp.json()["token"]

    pub_hidden = seeded_client.get(f"/api/public/vacancy/{token}")
    assert pub_hidden.status_code == 200, pub_hidden.text
    assert all(b["bed_code"] != bed_b["bed_code"] for b in pub_hidden.json()["available_beds"])

    # Unhide Bed 701-B -> appears on public page
    unhide_resp = seeded_client.patch(
        f"/api/vacancy/beds/{bed_b['id']}",
        headers=bearer(owner_token),
        json={"is_publicly_available": True},
    )
    assert unhide_resp.status_code == 200
    pub_shown = seeded_client.get(f"/api/public/vacancy/{token}")
    assert pub_shown.status_code == 200
    assert any(b["bed_code"] == bed_b["bed_code"] for b in pub_shown.json()["available_beds"])

    # Strict public privacy check: zero tenant PII in public endpoints
    pub_blob = json.dumps(pub_shown.json()) + json.dumps(seeded_client.get("/api/public/vacancies").json())
    for sensitive in ("Karan Mehta", "9876543219", "karan.e2e@example.com", "9800000001"):
        assert sensitive not in pub_blob

    # ------------------------------------------------------------------
    # 8. Checkout with Deposit Deduction & Maintenance Bed Guard
    # ------------------------------------------------------------------
    checkout_resp = seeded_client.post(
        f"/api/tenants/{tenant_id}/checkout",
        headers=bearer(manager_token),
        json={
            "leaving_date": today.isoformat(),
            "deduction_amount": 1000,
            "deduction_reason": "Deep cleaning",
            "checkout_remarks": "Keys returned",
            "mark_bed_maintenance": True,
        },
    )
    assert checkout_resp.status_code == 200, checkout_resp.text
    checkout_data = checkout_resp.json()
    assert Decimal(str(checkout_data["deduction_amount"])) == Decimal("1000.00")
    assert Decimal(str(checkout_data["refund_amount"])) == Decimal("9000.00")
    assert checkout_data["bed_status"] == "maintenance"

    # Bed 701-A placed in maintenance must NOT appear on public vacancy page
    pub_after_checkout = seeded_client.get(f"/api/public/vacancy/{token}").json()
    assert all(b["bed_code"] != bed_a["bed_code"] for b in pub_after_checkout["available_beds"])


def test_phase7_multi_pg_owner_isolation_and_settings(
    seeded_client: TestClient, db_session: Session
) -> None:
    """Verify multi-PG Owner access on /api/owner/pg?pg_id=, /api/files/*, and
    /api/complaints/{id}, while keeping Managers and unrelated Owners isolated."""

    owner = db_session.query(User).filter(User.mobile == "+919800000001").first()
    assert owner is not None

    # Create second PG owned by the same Owner, keeping owner.pg_id = PG #1
    pg2 = PGProperty(
        owner_id=owner.id,
        name="Sunrise Annex PG",
        address="88 Residency Road",
        city="Bengaluru",
        gender_policy=GenderPolicy.FEMALE,
        rent_due_day=10,
        default_monthly_rent=Decimal("9500.00"),
        default_food_charges=Decimal("2000.00"),
        default_security_deposit=Decimal("10000.00"),
        amenities="Wi-Fi, Security",
    )
    db_session.add(pg2)
    db_session.flush()

    room2 = Room(
        pg_id=pg2.id,
        room_number="A-101",
        floor="1st Floor",
        sharing_type=SharingType.SINGLE,
        max_capacity=1,
        base_rent=Decimal("9500.00"),
        is_active=True,
    )
    db_session.add(room2)
    db_session.flush()

    bed2 = Bed(
        pg_id=pg2.id,
        room_id=room2.id,
        bed_label="A",
        bed_code="A-101-A",
        monthly_rent=Decimal("9500.00"),
        food_charges=Decimal("2000.00"),
        status=BedStatus.OCCUPIED,
    )
    db_session.add(bed2)
    db_session.flush()

    tenant2_user = User(
        pg_id=pg2.id,
        full_name="Meera Nair",
        mobile="+919812345670",
        password_hash=hash_password("Tenant@123"),
        role=UserRole.TENANT,
        is_active=True,
    )
    db_session.add(tenant2_user)
    db_session.flush()

    tenant2 = Tenant(
        pg_id=pg2.id,
        user_id=tenant2_user.id,
        room_id=room2.id,
        bed_id=bed2.id,
        full_name="Meera Nair",
        mobile="+919812345670",
        monthly_rent=Decimal("9500.00"),
        food_charges=Decimal("2000.00"),
        joining_date=date.today(),
        emergency_contact_name="Suresh Nair",
        emergency_contact_phone="9812300001",
        status=TenantStatus.ACTIVE,
    )
    db_session.add(tenant2)
    db_session.flush()

    # Create upload files referenced by PG #2 records inside configured UPLOAD_DIR
    upload_dir = Path(get_settings().UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    doc_path = upload_dir / "pg2_doc.png"
    comp_path = upload_dir / "pg2_comp.png"
    food_path = upload_dir / "pg2_food.png"
    doc_path.write_bytes(MINIMAL_PNG)
    comp_path.write_bytes(MINIMAL_PNG)
    food_path.write_bytes(MINIMAL_PNG)

    doc2 = TenantDocument(
        tenant_id=tenant2.id,
        doc_type=DocumentType.ID_PROOF,
        file_name="pg2_doc.png",
        file_path=str(doc_path),
        mime_type="image/png",
    )
    db_session.add(doc2)

    comp2 = Complaint(
        pg_id=pg2.id,
        tenant_id=tenant2.id,
        room_id=room2.id,
        bed_id=bed2.id,
        room_number_snapshot="A-101",
        bed_code_snapshot="A-101-A",
        title="PG2 Wi-Fi slow",
        description="Router restarts frequently",
        category=ComplaintCategory.WIFI,
        status=ComplaintStatus.SUBMITTED,
    )
    db_session.add(comp2)
    db_session.flush()

    comp_img2 = ComplaintImage(
        complaint_id=comp2.id,
        file_name="pg2_comp.png",
        file_path=str(comp_path),
        mime_type="image/png",
    )
    db_session.add(comp_img2)

    food2 = FoodMenu(
        pg_id=pg2.id,
        day_of_week=DayOfWeek.TUESDAY,
        meal_type=MealType.BREAKFAST,
        meal_name="Idli Sambar",
        items_description="Steamed idli with coconut chutney",
        timing_label="07:30 AM - 09:30 AM",
        image_path=str(food_path),
        is_available=True,
        is_published=True,
    )
    db_session.add(food2)

    # Create an unrelated second Owner on a separate PG #3
    other_owner = User(
        full_name="Other Owner",
        mobile="+919899887766",
        password_hash=hash_password("Owner@123"),
        role=UserRole.OWNER,
        is_active=True,
    )
    db_session.add(other_owner)
    db_session.flush()

    pg3 = PGProperty(
        owner_id=other_owner.id,
        name="Third Party PG",
        address="12 MG Road",
        city="Pune",
        gender_policy=GenderPolicy.COED,
        rent_due_day=5,
    )
    db_session.add(pg3)
    db_session.flush()
    other_owner.pg_id = pg3.id
    db_session.commit()

    owner_token = _api_login(seeded_client, "9800000001", "Owner@123")
    manager_token = _api_login(seeded_client, "9800000002", "Manager@123")
    other_owner_token = _api_login(seeded_client, "9899887766", "Owner@123")

    # Owner switches PG via ?pg_id= on GET and PUT /api/owner/pg
    pg2_get = seeded_client.get(f"/api/owner/pg?pg_id={pg2.id}", headers=bearer(owner_token))
    assert pg2_get.status_code == 200, pg2_get.text
    assert pg2_get.json()["name"] == "Sunrise Annex PG"

    pg2_put = seeded_client.put(
        f"/api/owner/pg?pg_id={pg2.id}",
        headers=bearer(owner_token),
        json={"rent_due_day": 12, "city": "Mumbai"},
    )
    assert pg2_put.status_code == 200, pg2_put.text
    assert pg2_put.json()["rent_due_day"] == 12
    assert pg2_put.json()["city"] == "Mumbai"

    # Owner can view PG #2 protected files and complaint details despite owner.pg_id == 1
    assert seeded_client.get(f"/api/complaints/{comp2.id}", headers=bearer(owner_token)).status_code == 200
    assert (
        seeded_client.get(f"/api/files/tenant-docs/{doc2.id}", headers=bearer(owner_token)).status_code
        == 200
    )
    assert (
        seeded_client.get(
            f"/api/files/complaint-images/{comp_img2.id}", headers=bearer(owner_token)
        ).status_code
        == 200
    )
    assert (
        seeded_client.get(f"/api/files/food-images/{food2.id}", headers=bearer(owner_token)).status_code
        == 200
    )

    # PG #1 Manager and unrelated Owner are strictly blocked (403) from PG #2 resources
    for forbidden_tok in (manager_token, other_owner_token):
        assert (
            seeded_client.get(f"/api/complaints/{comp2.id}", headers=bearer(forbidden_tok)).status_code
            == 403
        )
        assert (
            seeded_client.get(
                f"/api/files/tenant-docs/{doc2.id}", headers=bearer(forbidden_tok)
            ).status_code
            == 403
        )
        assert (
            seeded_client.get(
                f"/api/files/complaint-images/{comp_img2.id}", headers=bearer(forbidden_tok)
            ).status_code
            == 403
        )
        assert (
            seeded_client.get(
                f"/api/files/food-images/{food2.id}", headers=bearer(forbidden_tok)
            ).status_code
            == 403
        )

    assert (
        seeded_client.get(f"/api/owner/pg?pg_id={pg2.id}", headers=bearer(other_owner_token)).status_code
        == 403
    )
