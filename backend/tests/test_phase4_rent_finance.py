from datetime import date
import hashlib
import hmac

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models.enums import GenderPolicy, SharingType, UserRole
from app.models.finance import RentRecord
from app.models.property import Bed, PGProperty, Room
from app.models.tenant import Tenant
from app.models.user import User
from tests.conftest import bearer, login_token


def _rzp_sig(secret: str, order_id: str, payment_id: str) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def test_1_2_3_4_19_monthly_rent_generation_proration_eligibility_and_history_preservation(
    seeded_client, db_session: Session
):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")

    # Register a tenant joining mid-month (16th of a 30-day month -> April 2026: 15/30 days = 50%)
    beds = seeded_client.get("/api/beds", headers=bearer(mgr_tok)).json()
    vacant = next(b for b in beds if b["status"] == "vacant")

    reg = seeded_client.post(
        "/api/tenants",
        headers=bearer(mgr_tok),
        json={
            "full_name": "Prorated Resident",
            "mobile": "9855551111",
            "bed_id": vacant["id"],
            "monthly_rent": "8000.00",
            "food_charges": "1000.00",
            "security_deposit_amount": "12000.00",
            "joining_date": "2026-04-16",
            "emergency_contact_name": "Parent",
            "emergency_contact_phone": "9855551112",
        },
    )
    assert reg.status_code == 200, reg.text
    prorated_tenant = reg.json()["tenant"]

    # Check April 2026 generated record created during registration: 15/30 days = 4000 rent + 500 food = 4500
    hist = seeded_client.get(
        f"/api/rent/tenants/{prorated_tenant['id']}/history",
        headers=bearer(mgr_tok),
    ).json()
    apr_rec = next(r for r in hist if r["billing_month"] == 4 and r["billing_year"] == 2026)
    assert apr_rec["base_rent"] == "4000.00"
    assert apr_rec["food_charges"] == "500.00"
    assert apr_rec["total_amount"] == "4500.00"

    # 1. Generate rent for March 2026 -> Prorated Resident was NOT eligible in March 2026!
    gen_mar = seeded_client.post(
        "/api/rent/generate",
        headers=bearer(mgr_tok),
        json={"billing_month": 3, "billing_year": 2026},
    )
    assert gen_mar.status_code == 200
    assert gen_mar.json()["ineligible_count"] >= 1
    assert all(r["tenant_id"] != prorated_tenant["id"] for r in gen_mar.json()["records"])

    # 2. Generate rent for May 2026 (full month = 8000 + 1000) and repeat -> duplicate skipped!
    gen_may_1 = seeded_client.post(
        "/api/rent/generate",
        headers=bearer(mgr_tok),
        json={"billing_month": 5, "billing_year": 2026},
    )
    assert gen_may_1.status_code == 200
    assert gen_may_1.json()["created_count"] >= 1
    may_rec = next(
        r for r in gen_may_1.json()["records"] if r["tenant_id"] == prorated_tenant["id"]
    )
    assert may_rec["base_rent"] == "8000.00"
    assert may_rec["food_charges"] == "1000.00"
    assert may_rec["total_amount"] == "9000.00"

    gen_may_2 = seeded_client.post(
        "/api/rent/generate",
        headers=bearer(mgr_tok),
        json={"billing_month": 5, "billing_year": 2026},
    )
    assert gen_may_2.status_code == 200
    assert gen_may_2.json()["created_count"] == 0
    assert gen_may_2.json()["skipped_existing_count"] >= 1

    # Add authorized other_charges to May record
    upd_rec = seeded_client.patch(
        f"/api/rent/records/{may_rec['id']}",
        headers=bearer(mgr_tok),
        json={"other_charges": "350.00", "other_charges_note": "Duplicate key fee"},
    )
    assert upd_rec.status_code == 200
    assert upd_rec.json()["total_amount"] == "9350.00"

    # 19. Changing tenant monthly_rent later MUST NOT silently overwrite historical April/May records!
    t_upd = seeded_client.patch(
        f"/api/tenants/{prorated_tenant['id']}",
        headers=bearer(mgr_tok),
        json={"monthly_rent": "10500.00"},
    )
    assert t_upd.status_code == 200

    hist_after = seeded_client.get(
        f"/api/rent/tenants/{prorated_tenant['id']}/history",
        headers=bearer(mgr_tok),
    ).json()
    may_after = next(r for r in hist_after if r["billing_month"] == 5 and r["billing_year"] == 2026)
    assert may_after["base_rent"] == "8000.00"
    assert may_after["total_amount"] == "9350.00"


def test_5_6_7_8_9_10_15_16_offline_partial_full_overdue_duplicate_and_receipts(
    seeded_client, db_session: Session
):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    neha_tok = login_token(seeded_client, "9800000004", "Tenant@123")

    neha_rent = seeded_client.get("/api/rent/my", headers=bearer(neha_tok)).json()["current_rent"]
    rent_id = neha_rent["id"]

    # 8. Force due_date into past to verify overdue calculation
    rec = db_session.get(RentRecord, rent_id)
    assert rec is not None
    rec.due_date = date(2025, 1, 5)
    db_session.commit()

    outstanding = seeded_client.get("/api/rent/records/outstanding", headers=bearer(mgr_tok)).json()
    neha_out = next(r for r in outstanding if r["id"] == rent_id)
    assert neha_out["status"] == "overdue"

    # Set due_date to far future to verify partial status on partial payment
    seeded_client.patch(
        f"/api/rent/records/{rent_id}",
        headers=bearer(mgr_tok),
        json={"due_date": "2099-12-05"},
    )

    # 10. Invalid payment amounts rejected
    assert (
        seeded_client.post(
            "/api/payments/offline",
            headers=bearer(mgr_tok),
            json={"rent_record_id": rent_id, "amount": "0", "payment_method": "cash"},
        ).status_code
        == 422
    )
    assert (
        seeded_client.post(
            "/api/payments/offline",
            headers=bearer(mgr_tok),
            json={"rent_record_id": rent_id, "amount": "99999", "payment_method": "cash"},
        ).status_code
        == 422
    )

    # 5 & 7. Partial offline payment (3000 out of 8500 -> balance 5500, status partial)
    p1 = seeded_client.post(
        "/api/payments/offline",
        headers=bearer(mgr_tok),
        json={
            "rent_record_id": rent_id,
            "amount": "3000.00",
            "payment_method": "bank_transfer",
            "transaction_ref": "UTR-UNIQUE-101",
            "notes": "First installment",
        },
    )
    assert p1.status_code == 200, p1.text
    p1_id = p1.json()["id"]

    rec_after_p1 = seeded_client.get(f"/api/rent/records/{rent_id}", headers=bearer(mgr_tok)).json()
    assert rec_after_p1["status"] == "partial"
    assert rec_after_p1["amount_paid"] == "3000.00"
    assert rec_after_p1["balance_due"] == "5500.00"

    # 9. Duplicate transaction reference rejected (409)
    dup_ref = seeded_client.post(
        "/api/payments/offline",
        headers=bearer(mgr_tok),
        json={
            "rent_record_id": rent_id,
            "amount": "1000.00",
            "payment_method": "bank_transfer",
            "transaction_ref": "UTR-UNIQUE-101",
        },
    )
    assert dup_ref.status_code == 409

    # 15 & 16. Receipt accuracy after partial payment (remaining_balance = 5500.00)
    rcpt1 = seeded_client.get(f"/api/receipts/{p1_id}", headers=bearer(neha_tok))
    assert rcpt1.status_code == 200
    assert rcpt1.json()["amount_paid"] == "3000.00"
    assert rcpt1.json()["remaining_balance"] == "5500.00"
    assert rcpt1.json()["payment_status"] == "partial"
    assert rcpt1.json()["gateway_payment_id"] == "UTR-UNIQUE-101"

    pdf1 = seeded_client.get(f"/api/receipts/{p1_id}/download", headers=bearer(neha_tok))
    assert pdf1.status_code == 200
    assert pdf1.content.startswith(b"%PDF-1.4")

    # 6. Full remaining payment (5500 -> paid, balance 0)
    p2 = seeded_client.post(
        "/api/payments/offline",
        headers=bearer(mgr_tok),
        json={
            "rent_record_id": rent_id,
            "amount": "5500.00",
            "payment_method": "cash",
            "notes": "Remaining balance",
        },
    )
    assert p2.status_code == 200
    rec_after_p2 = seeded_client.get(f"/api/rent/records/{rent_id}", headers=bearer(mgr_tok)).json()
    assert rec_after_p2["status"] == "paid"
    assert rec_after_p2["balance_due"] == "0.00"


def test_11_12_tenant_and_manager_property_access_restrictions(seeded_client, db_session: Session):
    rahul_tok = login_token(seeded_client, "9800000003", "Tenant@123")
    mgr_a_tok = login_token(seeded_client, "9800000002", "Manager@123")

    neha = db_session.scalar(select(Tenant).where(Tenant.mobile == "+919800000004"))
    assert neha is not None

    # 11. Rahul cannot access Neha's payments, rent history, or deposit
    assert seeded_client.get(f"/api/payments?tenant_id={neha.id}", headers=bearer(rahul_tok)).status_code == 403
    assert seeded_client.get(f"/api/rent/tenants/{neha.id}/history", headers=bearer(rahul_tok)).status_code == 403
    assert seeded_client.get(f"/api/deposits/{neha.id}", headers=bearer(rahul_tok)).status_code == 403

    # Create a separate PG B with its own Owner & Manager B
    owner_b = User(
        full_name="Owner B",
        mobile="+919866660001",
        password_hash=hash_password("OwnerB@123"),
        role=UserRole.OWNER,
        is_active=True,
    )
    db_session.add(owner_b)
    db_session.flush()
    pg_b = PGProperty(owner_id=owner_b.id, name="Other PG B", gender_policy=GenderPolicy.COED)
    db_session.add(pg_b)
    db_session.flush()
    owner_b.pg_id = pg_b.id

    mgr_b = User(
        pg_id=pg_b.id,
        full_name="Manager B",
        mobile="+919866660002",
        password_hash=hash_password("ManagerB@123"),
        role=UserRole.MANAGER,
        is_active=True,
    )
    db_session.add(mgr_b)
    room_b = Room(pg_id=pg_b.id, room_number="B1", floor="1st", sharing_type=SharingType.SINGLE, base_rent=9000)
    db_session.add(room_b)
    db_session.flush()
    bed_b = Bed(pg_id=pg_b.id, room_id=room_b.id, bed_label="A", bed_code="B1-A", monthly_rent=9000)
    db_session.add(bed_b)
    db_session.commit()

    mgr_b_tok = login_token(seeded_client, "9866660002", "ManagerB@123")

    # 12. Manager B cannot access PG A's rent records, payments, or deposits (and Manager A sees only PG A)
    pg_a_records = seeded_client.get("/api/rent/records", headers=bearer(mgr_a_tok)).json()
    assert len(pg_a_records) > 0
    pg_a_rec_id = pg_a_records[0]["id"]

    assert seeded_client.get(f"/api/rent/records/{pg_a_rec_id}", headers=bearer(mgr_b_tok)).status_code == 403
    assert seeded_client.get(f"/api/deposits/{neha.id}", headers=bearer(mgr_b_tok)).status_code == 403
    assert seeded_client.get("/api/rent/records", headers=bearer(mgr_b_tok)).json() == []


def test_13_14_razorpay_signature_and_failed_gateway_handling(seeded_client, monkeypatch):
    neha_tok = login_token(seeded_client, "9800000004", "Tenant@123")
    rent_id = seeded_client.get("/api/rent/my", headers=bearer(neha_tok)).json()["current_rent"]["id"]

    settings = get_settings()
    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "rzp_test_secret")

    order_counter = {"n": 0}

    def _fake_rzp_post(*args, **kwargs):
        order_counter["n"] += 1
        n = order_counter["n"]

        class _Resp:
            def raise_for_status(self):
                return None

            def json(self):
                return {"id": f"order_rzp_{n}"}

        return _Resp()

    monkeypatch.setattr("app.services.payment_service.httpx.post", _fake_rzp_post)

    # 14. Explicit gateway fail keeps balance untouched & never creates receipt
    o1 = seeded_client.post(
        "/api/payments/orders",
        headers=bearer(neha_tok),
        json={"rent_record_id": rent_id, "payment_method": "card", "amount": "2000.00"},
    ).json()
    fail_res = seeded_client.post(
        "/api/payments/fail",
        headers=bearer(neha_tok),
        json={"payment_id": o1["payment_id"], "gateway_order_id": o1["gateway_order_id"], "reason": "Bank timeout"},
    )
    assert fail_res.status_code == 200
    assert fail_res.json()["status"] == "failed"
    assert seeded_client.get(f"/api/receipts/{o1['payment_id']}", headers=bearer(neha_tok)).status_code == 404

    # 13. Valid signature succeeds & duplicate gateway_payment_id on second order is blocked
    o2 = seeded_client.post(
        "/api/payments/orders",
        headers=bearer(neha_tok),
        json={"rent_record_id": rent_id, "payment_method": "net_banking", "amount": "4000.00"},
    ).json()
    sig2 = _rzp_sig("rzp_test_secret", o2["gateway_order_id"], "pay_rzp_tx_900")
    ok2 = seeded_client.post(
        "/api/payments/verify",
        headers=bearer(neha_tok),
        json={
            "payment_id": o2["payment_id"],
            "gateway_order_id": o2["gateway_order_id"],
            "gateway_payment_id": "pay_rzp_tx_900",
            "gateway_signature": sig2,
        },
    )
    assert ok2.status_code == 200

    # Replaying same gateway_payment_id on a new order is rejected with 409
    o3 = seeded_client.post(
        "/api/payments/orders",
        headers=bearer(neha_tok),
        json={"rent_record_id": rent_id, "payment_method": "upi", "amount": "1000.00"},
    ).json()
    sig3 = _rzp_sig("rzp_test_secret", o3["gateway_order_id"], "pay_rzp_tx_900")
    dup_gw = seeded_client.post(
        "/api/payments/verify",
        headers=bearer(neha_tok),
        json={
            "payment_id": o3["payment_id"],
            "gateway_order_id": o3["gateway_order_id"],
            "gateway_payment_id": "pay_rzp_tx_900",
            "gateway_signature": sig3,
        },
    )
    assert dup_gw.status_code == 409


def test_17_18_security_deposit_accounting_and_invalid_refund_prevention(seeded_client, db_session: Session):
    mgr_tok = login_token(seeded_client, "9800000002", "Manager@123")
    owner_tok = login_token(seeded_client, "9800000001", "Owner@123")

    neha = db_session.scalar(select(Tenant).where(Tenant.mobile == "+919800000004"))
    assert neha is not None

    # 17. Security deposit is tracked separately and never counted as rent collected
    fin_before = seeded_client.get("/api/v1/owner/finance/dashboard", headers=bearer(owner_tok)).json()
    collected_before = fin_before["total_collected_rent"]

    # Record deduction of 2500 -> refundable balance becomes 12500
    ded = seeded_client.post(
        f"/api/deposits/{neha.id}/transactions",
        headers=bearer(mgr_tok),
        json={
            "transaction_type": "deduction",
            "amount": "2500.00",
            "reason": "Damaged study chair",
        },
    )
    assert ded.status_code == 200
    assert ded.json()["deduction_amount"] == "2500.00"
    assert ded.json()["refundable_balance"] == "12500.00"

    # Rent collected must remain unchanged by deposit transactions
    fin_after = seeded_client.get("/api/v1/owner/finance/dashboard", headers=bearer(owner_tok)).json()
    assert fin_after["total_collected_rent"] == collected_before

    # 18. Cannot refund more than available refundable balance (12500)
    bad_ref = seeded_client.post(
        f"/api/deposits/{neha.id}/transactions",
        headers=bearer(mgr_tok),
        json={
            "transaction_type": "refund",
            "amount": "13000.00",
            "payment_method": "bank_transfer",
            "reason": "Over-refund attempt",
        },
    )
    assert bad_ref.status_code == 422

    # Valid partial refund of 12500 succeeds -> refundable balance 0
    ok_ref = seeded_client.post(
        f"/api/deposits/{neha.id}/transactions",
        headers=bearer(mgr_tok),
        json={
            "transaction_type": "refund",
            "amount": "12500.00",
            "payment_method": "bank_transfer",
            "reference_id": "DEP-REF-001",
            "reason": "Final deposit refund",
        },
    )
    assert ok_ref.status_code == 200
    assert ok_ref.json()["refundable_balance"] == "0.00"
    assert ok_ref.json()["paid_status"] == "partially_refunded"
    assert len(ok_ref.json()["transactions"]) >= 2

