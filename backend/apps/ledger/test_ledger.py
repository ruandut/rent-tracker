from datetime import date
from decimal import Decimal

import pytest
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
