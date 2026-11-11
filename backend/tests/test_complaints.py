from tests.conftest import bearer, login_token


def test_complaint_submission_lifecycle_image_isolation_and_rating(seeded_client):
    neha_tok = login_token(seeded_client, "9800000004", "Tenant@123")
    rahul_tok = login_token(seeded_client, "9800000003", "Tenant@123")
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")

    # Submit complaint with photo attachment
    submit = seeded_client.post(
        "/api/v1/tenant/complaints",
        headers=bearer(neha_tok),
        data={
            "category": "door_lock",
            "title": "Main room door latch loose",
            "description": "Lock sticks when closing from inside.",
        },
        files={"image": ("door_lock.png", b"\x89PNG\r\n\x1a\nfakeimg", "image/png")},
    )
    assert submit.status_code == 200, submit.text
    complaint = submit.json()
    cid = complaint["id"]
    assert complaint["status"] == "submitted"
    assert complaint["room_number"] == "101"
    assert len(complaint["images"]) == 1
    img_url = complaint["images"][0]["url"]

    # Image access check: submitting tenant & manager OK, other tenant blocked
    assert seeded_client.get(img_url, headers=bearer(neha_tok)).status_code == 200
    assert seeded_client.get(img_url, headers=bearer(mgr_tok)).status_code == 200
    assert seeded_client.get(img_url, headers=bearer(rahul_tok)).status_code == 403

    # Cannot rate before resolved
    premature_rate = seeded_client.post(
        f"/api/v1/tenant/complaints/{cid}/rate",
        headers=bearer(neha_tok),
        json={"rating": 5, "feedback": "Early"},
    )
    assert premature_rate.status_code == 400

    # Manager searches & filters complaints
    mgr_list = seeded_client.get(
        "/api/v1/manager/complaints",
        headers=bearer(mgr_tok),
        params={"status_group": "new", "search": "Neha"},
    )
    assert mgr_list.status_code == 200
    assert any(c["id"] == cid for c in mgr_list.json()["complaints"])

    # Manager transitions: viewed -> in_progress -> resolved
    for next_status, remark in [
        ("viewed_by_manager", "Saw photo, assigning carpenter."),
        ("in_progress", "Carpenter fixing latch."),
        ("resolved", "Replaced door latch completely."),
    ]:
        upd = seeded_client.patch(
            f"/api/v1/manager/complaints/{cid}/status",
            headers=bearer(mgr_tok),
            json={"status": next_status, "remarks": remark},
        )
        assert upd.status_code == 200
        assert upd.json()["status"] == next_status

    # Tenant sees updated timeline & notifications, and can now rate resolved complaint
    tenant_list = seeded_client.get("/api/v1/tenant/complaints", headers=bearer(neha_tok)).json()
    updated_c = next(c for c in tenant_list if c["id"] == cid)
    assert updated_c["status"] == "resolved"
    assert len(updated_c["history"]) == 4
    assert updated_c["resolved_at"] is not None

    rate_resp = seeded_client.post(
        f"/api/v1/tenant/complaints/{cid}/rate",
        headers=bearer(neha_tok),
        json={"rating": 5, "feedback": "Quick repair!"},
    )
    assert rate_resp.status_code == 200
    assert rate_resp.json()["tenant_rating"] == 5

    # Other tenant cannot rate Neha's complaint
    other_rate = seeded_client.post(
        f"/api/v1/tenant/complaints/{cid}/rate",
        headers=bearer(rahul_tok),
        json={"rating": 1},
    )
    assert other_rate.status_code == 404

    notifs = seeded_client.get("/api/v1/tenant/notifications", headers=bearer(neha_tok)).json()
    assert len(notifs) >= 3

