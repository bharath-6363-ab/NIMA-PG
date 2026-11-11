import hashlib
import hmac

from app.core.config import get_settings
from tests.conftest import bearer, login_token


def _rzp_sig(secret: str, order_id: str, payment_id: str) -> str:
    return hmac.new(secret.encode("utf-8"), f"{order_id}|{payment_id}".encode("utf-8"), hashlib.sha256).hexdigest()


def test_rent_calculation_verified_payment_receipt_and_isolation(seeded_client, monkeypatch):
    neha_tok = login_token(seeded_client, "9800000004", "Tenant@123")
    rahul_tok = login_token(seeded_client, "9800000003", "Tenant@123")

    summary_resp = seeded_client.get("/api/rent/my", headers=bearer(neha_tok))
    assert summary_resp.status_code == 200
    summary = summary_resp.json()
    assert summary["tenant_name"] == "Neha Patel"
    assert summary["room_number"] == "101"
    assert summary["bed_code"] == "101-B"
    assert summary["current_rent"]["base_rent"] == "7500.00"
    assert summary["current_rent"]["food_charges"] == "1000.00"
    assert summary["current_rent"]["total_amount"] == "8500.00"
    assert summary["current_rent"]["balance_due"] == "8500.00"
    assert summary["security_deposit"]["amount_held"] == "15000.00"
    rent_id = summary["current_rent"]["id"]

    # Without Razorpay credentials, online order creation refuses simulated online payments (503)
    unconfigured = seeded_client.post(
        "/api/payments/orders",
        headers=bearer(neha_tok),
        json={"rent_record_id": rent_id, "payment_method": "upi"},
    )
    assert unconfigured.status_code == 503

    # Configure Razorpay test-mode credentials & mock Razorpay Orders API response
    settings = get_settings()
    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", "rzp_test_12345")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "rzp_secret_67890")

    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"id": "order_rzp_test_001"}

    monkeypatch.setattr("app.services.payment_service.httpx.post", lambda *a, **kw: _FakeResp())

    order_resp = seeded_client.post(
        "/api/payments/orders",
        headers=bearer(neha_tok),
        json={"rent_record_id": rent_id, "payment_method": "upi"},
    )
    assert order_resp.status_code == 200
    order = order_resp.json()
    assert order["gateway_order_id"] == "order_rzp_test_001"

    # Tampered signature must NEVER mark payment successful
    tampered = seeded_client.post(
        "/api/payments/verify",
        headers=bearer(neha_tok),
        json={
            "payment_id": order["payment_id"],
            "gateway_order_id": order["gateway_order_id"],
            "gateway_payment_id": "pay_forged_123",
            "gateway_signature": "invalid_signature",
        },
    )
    assert tampered.status_code == 400

    # Valid Razorpay signature succeeds
    valid_sig = _rzp_sig("rzp_secret_67890", order["gateway_order_id"], "pay_rzp_valid_001")
    verified = seeded_client.post(
        "/api/payments/verify",
        headers=bearer(neha_tok),
        json={
            "payment_id": order["payment_id"],
            "gateway_order_id": order["gateway_order_id"],
            "gateway_payment_id": "pay_rzp_valid_001",
            "gateway_signature": valid_sig,
        },
    )
    assert verified.status_code == 200, verified.text
    v_data = verified.json()
    assert v_data["status"] == "verified_paid"
    assert v_data["receipt_number"].startswith("RCPT-")

    after_summary = seeded_client.get("/api/rent/my", headers=bearer(neha_tok)).json()
    assert after_summary["current_rent"]["status"] == "paid"
    assert after_summary["current_rent"]["balance_due"] == "0.00"

    # Receipt detail + PDF download
    receipt_json = seeded_client.get(
        f"/api/receipts/{order['payment_id']}",
        headers=bearer(neha_tok),
    )
    assert receipt_json.status_code == 200
    assert receipt_json.json()["remaining_balance"] == "0.00"

    receipt_pdf = seeded_client.get(
        f"/api/receipts/{order['payment_id']}/download",
        headers=bearer(neha_tok),
    )
    assert receipt_pdf.status_code == 200
    assert receipt_pdf.headers["content-type"].startswith("application/pdf")
    assert receipt_pdf.content.startswith(b"%PDF-1.4")

    # Cross-tenant isolation: Rahul must NOT see Neha's receipt
    assert (
        seeded_client.get(
            f"/api/receipts/{order['payment_id']}",
            headers=bearer(rahul_tok),
        ).status_code
        == 403
    )
