from datetime import date, timedelta

from tests.conftest import bearer, login_token


def test_food_menu_updates_meal_skip_and_ratings(seeded_client):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    tenant_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    # Manager updates Monday lunch
    upd = seeded_client.put(
        "/api/v1/manager/food/menu",
        headers=bearer(mgr_tok),
        json={
            "slots": [
                {
                    "day_of_week": "monday",
                    "meal_type": "lunch",
                    "items_description": "Special Rajma Chawal, Jeera Aloo, Raita",
                    "timing_label": "12:30 PM - 2:30 PM",
                }
            ]
        },
    )
    assert upd.status_code == 200

    # Tenant sees updated Monday lunch
    t_menu = seeded_client.get("/api/v1/tenant/food/menu", headers=bearer(tenant_tok))
    assert t_menu.status_code == 200
    monday_lunch = next(
        s for s in t_menu.json()["weekly_menu"]
        if s["day_of_week"] == "monday" and s["meal_type"] == "lunch"
    )
    assert "Special Rajma Chawal" in monday_lunch["items_description"]

    # Tenant skips tomorrow's dinner
    tomorrow = date.today() + timedelta(days=1)
    skip_resp = seeded_client.post(
        "/api/v1/tenant/food/skip",
        headers=bearer(tenant_tok),
        json={
            "skip_date": tomorrow.isoformat(),
            "meal_type": "dinner",
            "reason": "Dinner outside with friends",
        },
    )
    assert skip_resp.status_code == 200
    skip_id = skip_resp.json()["id"]

    # Tenant rates today's lunch
    rate_resp = seeded_client.post(
        "/api/v1/tenant/food/rate",
        headers=bearer(tenant_tok),
        json={
            "meal_date": date.today().isoformat(),
            "meal_type": "lunch",
            "rating": 4,
            "comment": "Tasty and fresh",
        },
    )
    assert rate_resp.status_code == 200
    assert rate_resp.json()["rating"] == 4

    # Manager food overview counts the skip and average rating
    mgr_food = seeded_client.get(
        "/api/v1/manager/food/menu",
        headers=bearer(mgr_tok),
        params={"target_date": tomorrow.isoformat()},
    )
    assert mgr_food.status_code == 200
    mf = mgr_food.json()
    assert mf["skip_counts"]["dinner"] == 1
    assert mf["average_ratings"]["lunch"] == 4.0

    # Tenant cancels skip
    undo = seeded_client.delete(f"/api/v1/tenant/food/skip/{skip_id}", headers=bearer(tenant_tok))
    assert undo.status_code == 200

    mgr_food_after = seeded_client.get(
        "/api/v1/manager/food/menu",
        headers=bearer(mgr_tok),
        params={"target_date": tomorrow.isoformat()},
    ).json()
    assert mgr_food_after["skip_counts"]["dinner"] == 0

