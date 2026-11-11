from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models.enums import GenderPolicy, MealType, UserRole
from app.models.finance import RentRecord
from app.models.property import PGProperty
from app.models.user import User
from app.services import food_service
from tests.conftest import bearer, login_token


def test_phase5_complaint_workflow_plumbing_validation_and_isolation(seeded_client):
    rahul_tok = login_token(seeded_client, "9800000003", "Tenant@123")
    neha_tok = login_token(seeded_client, "9800000004", "Tenant@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")

    # 1. Validation: short title/description rejected
    bad_title = seeded_client.post(
        "/api/complaints",
        headers=bearer(rahul_tok),
        data={"category": "plumbing", "title": "Hi", "description": "Valid long description here"},
    )
    assert bad_title.status_code == 422

    bad_desc = seeded_client.post(
        "/api/complaints",
        headers=bearer(rahul_tok),
        data={"category": "plumbing", "title": "Tap leaking", "description": "No"},
    )
    assert bad_desc.status_code == 422

    # 2. Submit valid plumbing complaint with photo attachment
    submit = seeded_client.post(
        "/api/complaints",
        headers=bearer(rahul_tok),
        data={
            "category": "plumbing",
            "title": "Bathroom sink pipe dripping",
            "description": "Water leaks continuously under the washbasin trap.",
        },
        files={"image": ("leak.png", b"\x89PNG\r\n\x1a\nfakeimg", "image/png")},
    )
    assert submit.status_code == 200, submit.text
    c = submit.json()
    cid = c["id"]
    assert c["category"] == "plumbing"
    assert c["status"] == "submitted"
    assert c["room_number"] == "101"
    assert c["bed_code"] == "101-A"
    assert len(c["images"]) == 1

    # 3. Tenant cannot modify status directly; other tenant cannot inspect complaint/image
    spoof_status = seeded_client.patch(
        f"/api/complaints/{cid}/status",
        headers=bearer(rahul_tok),
        json={"status": "resolved"},
    )
    assert spoof_status.status_code == 403

    other_detail = seeded_client.get(f"/api/complaints/{cid}", headers=bearer(neha_tok))
    assert other_detail.status_code == 403

    # Manager receives notification about new complaint
    mgr_notifs = seeded_client.get("/api/notifications", headers=bearer(mgr_tok)).json()
    assert any("Bathroom sink pipe dripping" in n["message"] for n in mgr_notifs)

    # 4. Manager filters & sorts complaints, moves Submitted -> Viewed -> In Progress -> Resolved
    listed = seeded_client.get(
        "/api/complaints",
        headers=bearer(mgr_tok),
        params={"category": "plumbing", "search": "101", "sort_order": "asc"},
    )
    assert listed.status_code == 200
    assert any(item["id"] == cid for item in listed.json()["complaints"])

    for next_st, remarks in [
        ("viewed_by_manager", "Logged for plumber inspection."),
        ("in_progress", "Plumber replacing PVC trap."),
        ("resolved", "Sink pipe leak fixed completely."),
    ]:
        upd = seeded_client.patch(
            f"/api/complaints/{cid}/status",
            headers=bearer(mgr_tok),
            json={"status": next_st, "remarks": remarks},
        )
        assert upd.status_code == 200, upd.text
        assert upd.json()["status"] == next_st
        assert upd.json()["assigned_manager_name"] == "Suresh Verma"

    # Cannot revert resolved complaint back to submitted
    revert = seeded_client.patch(
        f"/api/complaints/{cid}/status",
        headers=bearer(mgr_tok),
        json={"status": "submitted"},
    )
    assert revert.status_code == 400

    # 5. Tenant summary counters & rating after resolution
    detail = seeded_client.get(f"/api/complaints/{cid}", headers=bearer(rahul_tok)).json()
    assert detail["resolved_at"] is not None
    assert len(detail["history"]) == 4
    assert detail["history"][-1]["changed_by_name"] == "Suresh Verma"

    rated = seeded_client.post(
        f"/api/complaints/{cid}/rate",
        headers=bearer(rahul_tok),
        json={"rating": 5, "feedback": "Fast plumbing fix!"},
    )
    assert rated.status_code == 200
    assert rated.json()["tenant_rating"] == 5

    summary = seeded_client.get("/api/complaints/my", headers=bearer(rahul_tok)).json()
    assert summary["total_count"] >= 2
    assert summary["resolved_count"] >= 1
    assert (
        summary["open_count"] + summary["in_progress_count"] + summary["resolved_count"]
        == summary["total_count"]
    )


def test_phase5_food_menu_publishing_items_images_and_cross_pg_isolation(
    seeded_client, db_session: Session
):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    # 1. Manager creates/updates structured Monday Breakfast with FoodMenuItem list
    bulk = seeded_client.put(
        "/api/food/menu",
        headers=bearer(mgr_tok),
        json={
            "slots": [
                {
                    "day_of_week": "monday",
                    "meal_type": "breakfast",
                    "meal_name": "Protein Morning Combo",
                    "description": "Balanced breakfast platter",
                    "menu_items": [
                        {"item_name": "Poha", "is_veg": True},
                        {"item_name": "Boiled Eggs", "is_veg": False},
                        {"item_name": "Masala Tea", "is_veg": True},
                    ],
                    "timing_label": "7:30 AM - 9:30 AM",
                    "is_available": True,
                    "is_published": True,
                }
            ]
        },
    )
    assert bulk.status_code == 200, bulk.text
    mon_bf = next(
        s for s in bulk.json() if s["day_of_week"] == "monday" and s["meal_type"] == "breakfast"
    )
    assert mon_bf["meal_name"] == "Protein Morning Combo"
    assert len(mon_bf["menu_items"]) == 3
    assert mon_bf["menu_items"][1]["is_veg"] is False

    # 2. Single meal PATCH & meal photo upload
    patched = seeded_client.patch(
        f"/api/food/menu/{mon_bf['id']}",
        headers=bearer(mgr_tok),
        json={"meal_name": "Updated Protein Combo", "is_available": False},
    )
    assert patched.status_code == 200
    assert patched.json()["meal_name"] == "Updated Protein Combo"
    assert patched.json()["is_available"] is False

    img_up = seeded_client.post(
        f"/api/food/menu/{mon_bf['id']}/image",
        headers=bearer(mgr_tok),
        files={"file": ("thali.png", b"\x89PNG\r\n\x1a\nthalipic", "image/png")},
    )
    assert img_up.status_code == 200, img_up.text
    img_url = img_up.json()["image_url"]
    assert img_url is not None
    assert seeded_client.get(img_url, headers=bearer(tenant_tok)).status_code == 200

    # Create isolated second PG owner & verify food image cannot be accessed across PGs
    other_owner = User(
        full_name="Other Owner",
        mobile="+919899998888",
        email="otherfood@example.com",
        password_hash=hash_password("Pass@123"),
        role=UserRole.OWNER,
        is_active=True,
    )
    db_session.add(other_owner)
    db_session.flush()
    other_pg = PGProperty(
        owner_id=other_owner.id,
        name="Other PG",
        address="Other Street",
        city="Pune",
        gender_policy=GenderPolicy.COED,
    )
    db_session.add(other_pg)
    db_session.flush()
    other_owner.pg_id = other_pg.id
    db_session.commit()

    other_tok = login_token(seeded_client, "9899998888", "Pass@123")
    assert seeded_client.get(img_url, headers=bearer(other_tok)).status_code == 403

    # 3. Publish / Unpublish controls tenant visibility
    unpub = seeded_client.post(
        "/api/food/menu/publish",
        headers=bearer(mgr_tok),
        json={"is_published": False},
    )
    assert unpub.status_code == 200
    tenant_hidden = seeded_client.get("/api/food/tenant", headers=bearer(tenant_tok)).json()
    assert tenant_hidden["weekly_menu"] == []

    pub = seeded_client.post(
        "/api/food/menu/publish",
        headers=bearer(mgr_tok),
        json={"is_published": True},
    )
    assert pub.status_code == 200
    tenant_visible = seeded_client.get("/api/food/tenant", headers=bearer(tenant_tok)).json()
    assert len(tenant_visible["weekly_menu"]) >= 21


def test_phase5_meal_skip_cutoff_duplicates_privacy_and_ratings(
    seeded_client, db_session: Session, monkeypatch
):
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")
    other_tenant_tok = login_token(seeded_client, "9800000004", "Tenant@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")

    # Record initial food_charges on current rent to ensure meal skips never mutate rent
    before_rents = [
        r.food_charges
        for r in db_session.scalars(select(RentRecord)).all()
    ]

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    # 1. Past date skip rejected
    past_skip = seeded_client.post(
        "/api/food/skips",
        headers=bearer(tenant_tok),
        json={"skip_date": yesterday, "meal_type": "lunch"},
    )
    assert past_skip.status_code == 400

    # 2. Cutoff enforcement for today after cutoff
    monkeypatch.setattr(
        food_service,
        "get_cutoff_times",
        lambda: {"breakfast": "07:00", "lunch": "00:01", "dinner": "17:30"},
    )
    class FakeEvening:
        @staticmethod
        def date():
            return date.today()
        @staticmethod
        def time():
            return datetime.strptime("23:50", "%H:%M").time()

    orig_window = food_service._is_skip_window_open
    assert orig_window(date.today(), MealType.LUNCH, now_local=FakeEvening())[0] is False

    # Restore original cutoff map check for normal request
    monkeypatch.undo()

    # 3. Valid skip for tomorrow's lunch + duplicate prevention
    s1 = seeded_client.post(
        "/api/food/skips",
        headers=bearer(tenant_tok),
        json={"skip_date": tomorrow, "meal_type": "lunch", "reason": "Office lunch"},
    )
    assert s1.status_code == 200, s1.text
    skip_id = s1.json()["id"]
    assert s1.json()["status"] == "active"
    assert s1.json()["can_cancel"] is True

    dup = seeded_client.post(
        "/api/food/skips",
        headers=bearer(tenant_tok),
        json={"skip_date": tomorrow, "meal_type": "lunch", "reason": "Again"},
    )
    assert dup.status_code == 409

    # Other tenant cannot cancel Rahul's skip
    other_cancel = seeded_client.post(
        f"/api/food/skips/{skip_id}/cancel",
        headers=bearer(other_tenant_tok),
    )
    assert other_cancel.status_code == 404

    # 4. Manager food overview shows skip counts & details without exposing mobile/email
    mgr_food = seeded_client.get(
        "/api/food/manager",
        headers=bearer(mgr_tok),
        params={"target_date": tomorrow},
    ).json()
    assert mgr_food["skip_counts"]["lunch"] == 1
    assert len(mgr_food["skip_details"]) >= 1
    detail_row = mgr_food["skip_details"][0]
    assert "mobile" not in detail_row
    assert "email" not in detail_row

    # 5. Cancel skip and re-verify count drops to 0 cleanly while history row remains tracked
    cancel_ok = seeded_client.post(
        f"/api/food/skips/{skip_id}/cancel",
        headers=bearer(tenant_tok),
    )
    assert cancel_ok.status_code == 200
    mgr_food_after = seeded_client.get(
        "/api/food/manager",
        headers=bearer(mgr_tok),
        params={"target_date": tomorrow},
    ).json()
    assert mgr_food_after["skip_counts"]["lunch"] == 0

    # Verify rent food_charges remained completely untouched
    after_rents = [
        r.food_charges
        for r in db_session.scalars(select(RentRecord)).all()
    ]
    assert after_rents == before_rents

    # 6. Meal Ratings & Editing + Validation + Privacy
    future_rate = seeded_client.post(
        "/api/food/ratings",
        headers=bearer(tenant_tok),
        json={"meal_date": tomorrow, "meal_type": "breakfast", "rating": 5},
    )
    assert future_rate.status_code == 400

    bad_stars = seeded_client.post(
        "/api/food/ratings",
        headers=bearer(tenant_tok),
        json={"meal_date": date.today().isoformat(), "meal_type": "breakfast", "rating": 6},
    )
    assert bad_stars.status_code == 422

    rate1 = seeded_client.post(
        "/api/food/ratings",
        headers=bearer(tenant_tok),
        json={"meal_date": date.today().isoformat(), "meal_type": "breakfast", "rating": 3, "comment": "Okay"},
    )
    assert rate1.status_code == 200
    # Edit same rating -> updates instead of duplicating
    rate2 = seeded_client.post(
        "/api/food/ratings",
        headers=bearer(tenant_tok),
        json={"meal_date": date.today().isoformat(), "meal_type": "breakfast", "rating": 5, "comment": "Hot & crispy!"},
    )
    assert rate2.status_code == 200
    assert rate2.json()["id"] == rate1.json()["id"]
    assert rate2.json()["rating"] == 5

    mgr_ratings = seeded_client.get("/api/food/manager", headers=bearer(mgr_tok)).json()
    assert mgr_ratings["average_ratings"]["breakfast"] == 5.0
    assert mgr_ratings["rating_counts"]["breakfast"] == 1
    assert "mobile" not in mgr_ratings["recent_ratings"][0]
    assert get_settings().MEAL_SKIP_CUTOFF_BREAKFAST in mgr_ratings["cutoff_times"]["breakfast"]

