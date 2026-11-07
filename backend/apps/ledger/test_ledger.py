from datetime import date
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.ledger.models import Beneficiary, PaymentMethod, RentalUnit, Tag, Transaction


@pytest.fixture
def setup(db):
    unit_a = RentalUnit.objects.create(name="A")
    unit_b = RentalUnit.objects.create(name="B")
    bank = PaymentMethod.objects.create(name="Bank", opening_balance=Decimal("1000"))
    wife = Beneficiary.objects.create(name="Wife")
    maintenance = Tag.objects.get(name="maintenance")

    def tx(kind, amount, day, unit=None, **kw):
        return Transaction.objects.create(
            kind=kind,
            amount=Decimal(amount),
            date=day,
            description="x",
            payment_method=bank,
            rental_unit=unit,
            **kw,
        )

    tx("income", "500", date(2026, 1, 5), unit_a)
    tx("income", "300", date(2026, 2, 5), unit_b)
    fix = tx("expense", "200", date(2026, 2, 10), unit_a, beneficiary=wife)
    fix.tags.add(maintenance)
    return {"unit_a": unit_a, "unit_b": unit_b, "bank": bank, "wife": wife, "tag": maintenance}


def test_requires_auth(db):
    assert APIClient().get("/api/transactions/").status_code == 401


def test_maintenance_tag_is_seeded_and_protected(api):
    tag = Tag.objects.get(name="maintenance")
    assert tag.is_system
    assert api.delete(f"/api/tags/{tag.id}/").status_code == 400
    assert api.patch(f"/api/tags/{tag.id}/", {"color": "red"}).status_code == 200


def test_transactions_filter_by_range_and_unit(api, setup):
    rows = api.get("/api/transactions/", {"date_from": "2026-02-01"}).json()
    assert len(rows) == 2
    rows = api.get("/api/transactions/", {"unit": setup["unit_a"].id}).json()
    assert {r["amount"] for r in rows} == {500.0, 200.0}
    assert api.get("/api/transactions/", {"date_from": "nope"}).status_code == 400


def test_create_transaction_with_beneficiary_and_tags(api, setup):
    res = api.post(
        "/api/transactions/",
        {
            "kind": "expense",
            "amount": "50.25",
            "date": "2026-03-01",
            "description": "Plumber",
            "payment_method": setup["bank"].id,
            "beneficiary": setup["wife"].id,
            "tags": [setup["tag"].id],
        },
        format="json",
    )
    assert res.status_code == 201, res.json()
    assert res.json()["beneficiary_name"] == "Wife"
    assert res.json()["tags"] == [setup["tag"].id]
    bad = api.post("/api/transactions/", {**res.json(), "amount": "-5"}, format="json")
    assert bad.status_code == 400


def test_description_is_optional(api, setup):
    body = {
        "kind": "expense",
        "amount": "10",
        "date": "2026-03-01",
        "payment_method": setup["bank"].id,
    }
    res = api.post("/api/transactions/", body, format="json")
    assert res.status_code == 201, res.json()
    assert res.json()["description"] == ""
    assert (
        api.post("/api/transactions/", {**body, "description": ""}, format="json").status_code
        == 201
    )


def test_payment_method_balance_and_protected_delete(api, setup):
    [method] = api.get("/api/payment-methods/", {"unit": setup["unit_a"].id}).json()
    assert method["balance"] == 1600.0  # all-time, ignores filters
    assert (method["income"], method["expense"]) == (500.0, 200.0)
    assert api.delete(f"/api/payment-methods/{setup['bank'].id}/").status_code == 400


def test_dashboard_totals(api, setup):
    data = api.get("/api/dashboard/", {"date_from": "2026-01-01", "date_to": "2026-12-31"}).json()
    assert data["balance"] == 1600.0
    assert data["range"] == {"income": 800.0, "expense": 200.0, "net": 600.0}
    assert [m["month"] for m in data["monthly"]] == ["2026-01", "2026-02"]
    assert data["by_tag"][0]["name"] == "maintenance"


def test_annotated_lists_keep_name_order(api, setup):
    Tag.objects.create(name="aaa")
    Tag.objects.create(name="zzz")
    names = [t["name"] for t in api.get("/api/tags/").json()]
    assert names == sorted(names)


@pytest.fixture
def savings(setup):
    return PaymentMethod.objects.create(
        name="Savings", kind="savings_account", opening_balance=Decimal("50")
    )


def transfer_body(setup, savings, **overrides):
    return {
        "kind": "transfer",
        "amount": "400",
        "date": "2026-03-01",
        "payment_method": setup["bank"].id,
        "transfer_to": savings.id,
        **overrides,
    }


def test_transfer_moves_balances_without_touching_income_or_expense(api, setup, savings):
    res = api.post("/api/transactions/", transfer_body(setup, savings), format="json")
    assert res.status_code == 201, res.json()
    assert res.json()["transfer_to_name"] == "Savings"

    bank, saved = api.get("/api/payment-methods/").json()
    assert (bank["name"], bank["balance"], bank["moved_out"]) == ("Bank", 1200.0, 400.0)
    assert (saved["name"], saved["balance"], saved["moved_in"]) == ("Savings", 450.0, 400.0)
    assert (bank["income"], bank["expense"]) == (800.0, 200.0)  # transfers count as neither

    data = api.get("/api/dashboard/").json()
    assert (data["balance"], data["available"], data["savings"]) == (1650.0, 1200.0, 450.0)
    assert data["range"] == {"income": 800.0, "expense": 200.0, "net": 600.0}
    assert sum(m["income"] + m["expense"] for m in data["monthly"]) == 1000.0
    assert data["recent"][0]["kind"] == "transfer"


def test_balance_is_not_inflated_by_several_transactions_and_transfers(api, setup, savings):
    """Summing transfers in over the same join as `transactions` would repeat rows."""
    for amount in ("100", "150"):
        body = transfer_body(setup, savings, amount=amount)
        assert api.post("/api/transactions/", body, format="json").status_code == 201
    for amount in ("10", "20"):
        Transaction.objects.create(
            kind="income",
            amount=Decimal(amount),
            date=date(2026, 3, 2),
            payment_method=savings,
        )
    saved = api.get(f"/api/payment-methods/{savings.id}/").json()
    assert saved["balance"] == 330.0  # 50 opening + 250 moved + 30 interest
    assert (saved["income"], saved["moved_in"]) == (30.0, 250.0)


def test_transfer_totals_follow_the_date_filter_but_balance_does_not(api, setup, savings):
    api.post("/api/transactions/", transfer_body(setup, savings), format="json")
    params = {"date_to": "2026-02-28"}
    saved = api.get(f"/api/payment-methods/{savings.id}/", params).json()
    assert (saved["balance"], saved["moved_in"]) == (450.0, 0.0)
    rows = api.get("/api/payment-methods/", params).json()
    assert [r["moved_out"] for r in rows] == [0.0, 0.0]


def test_transfer_needs_two_different_accounts(api, setup, savings):
    missing = transfer_body(setup, savings, transfer_to=None)
    res = api.post("/api/transactions/", missing, format="json")
    assert res.status_code == 400 and "transfer_to" in res.json()
    same = transfer_body(setup, savings, transfer_to=setup["bank"].id)
    res = api.post("/api/transactions/", same, format="json")
    assert res.status_code == 400 and "transfer_to" in res.json()


def test_transfer_drops_unit_beneficiary_and_tags(api, setup, savings):
    body = transfer_body(
        setup,
        savings,
        rental_unit=setup["unit_a"].id,
        beneficiary=setup["wife"].id,
        tags=[setup["tag"].id],
    )
    res = api.post("/api/transactions/", body, format="json").json()
    assert (res["rental_unit"], res["beneficiary"], res["tags"]) == (None, None, [])


def test_changing_kind_keeps_transfer_fields_consistent(api, setup, savings):
    row = api.post("/api/transactions/", transfer_body(setup, savings), format="json").json()
    res = api.patch(f"/api/transactions/{row['id']}/", {"kind": "expense"}, format="json")
    assert res.status_code == 200, res.json()
    assert res.json()["transfer_to"] is None

    fix = Transaction.objects.get(kind="expense", amount=Decimal("200"))
    res = api.patch(
        f"/api/transactions/{fix.id}/",
        {"kind": "transfer", "transfer_to": savings.id},
        format="json",
    )
    assert res.status_code == 200, res.json()
    assert (res.json()["beneficiary"], res.json()["tags"]) == (None, [])
    assert api.patch(f"/api/transactions/{row['id']}/", {"kind": "transfer"}).status_code == 400


def test_payment_method_filter_finds_both_sides_of_a_transfer(api, setup, savings):
    row = api.post("/api/transactions/", transfer_body(setup, savings), format="json").json()
    rows = api.get("/api/transactions/", {"payment_method": savings.id}).json()
    assert [r["id"] for r in rows] == [row["id"]]
    rows = api.get("/api/transactions/", {"payment_method": setup["bank"].id}).json()
    assert row["id"] in {r["id"] for r in rows}
    assert [r["id"] for r in api.get("/api/transactions/", {"kind": "transfer"}).json()] == [
        row["id"]
    ]


def test_account_that_received_a_transfer_cannot_be_deleted(api, setup, savings):
    api.post("/api/transactions/", transfer_body(setup, savings), format="json")
    assert api.delete(f"/api/payment-methods/{savings.id}/").status_code == 400


def test_database_rejects_a_malformed_transfer(setup, savings):
    bank = setup["bank"]
    common = {"amount": Decimal("1"), "date": date(2026, 3, 1), "payment_method": bank}
    for bad in (
        {"kind": "transfer"},
        {"kind": "income", "transfer_to": savings},
        {"kind": "transfer", "transfer_to": bank},
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            Transaction.objects.create(**common, **bad)
