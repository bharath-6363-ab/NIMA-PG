def test_api_health_endpoint_reports_db_connectivity(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert "service" in data
    assert "environment" in data


def test_validation_error_format(client):
    resp = client.post("/api/v1/auth/login", json={"mobile": "12"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"] == "validation_error"
    assert isinstance(body["detail"], list)

