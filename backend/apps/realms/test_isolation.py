"""No endpoint shows, changes or links to another realm's data."""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from apps.bills.models import Bill, BillTemplate
from apps.ledger.models import Beneficiary, PaymentMethod, RentalUnit, Tag, Transaction
from apps.notifications.models import DeliverySettings, SummarySchedule
from apps.realms.models import RealmMembership
from apps.realms.services import create_realm
from apps.utilities.models import MunicipalCharge, UtilityReading
from conftest import client_for


@pytest.fixture
def theirs(db):
    """Someone else's realm with one of everything in it."""
    other = get_user_model().objects.create_user("other", password="pw")
    realm = create_realm(other, "Their realm")
    unit = RentalUnit.objects.create(realm=realm, name="Their unit")
    bank = PaymentMethod.objects.create(
        realm=realm, name="Their bank", opening_balance=Decimal("5000")
    )
    savings = PaymentMethod.objects.create(realm=realm, name="Their savings")
    payee = Beneficiary.objects.create(realm=realm, name="Their payee")
    tag = Tag.objects.get(realm=realm, name="maintenance")
    tx = Transaction.objects.create(
        realm=realm,
        kind="income",
        amount=Decimal("700"),
        date=date.today(),
        description="Their rent",
        payment_method=bank,
        rental_unit=unit,
    )
    template = BillTemplate.objects.get(realm=realm, is_default=True)
    res = client_for(other).post(
        "/api/bills/",
        {
            "template": template.id,
            "period": "2026-10-01",
            "account_number": "1001",
            "units": [
                {
                    "rental_unit": unit.id,
                    "lines": [{"section": "water", "amount_excl": "50", "usage": "4"}],
                }
            ],
        },
        format="json",
    )
    assert res.status_code == 201, res.json()
    reading = UtilityReading.objects.create(
        realm=realm, rental_unit=unit, kind="electricity", period=date(2026, 9, 1), usage=10
    )
    charge = MunicipalCharge.objects.create(
        realm=realm, rental_unit=unit, category="levy", period=date(2026, 9, 1), amount=10
    )
    schedule = SummarySchedule.objects.create(
        realm=realm,
        name="Theirs",
        channel="email",
        recipient="them@example.com",
        frequency="monthly",
        start_at="2030-01-01T08:00:00Z",
    )
    settings = DeliverySettings.load(realm)
    settings.smtp_host = "their.mail"
    settings.save()
    return {
        "user": other,
        "realm": realm,
        "units": unit,
        "payment-methods": bank,
        "savings": savings,
        "beneficiaries": payee,
        "tags": tag,
        "transactions": tx,
        "bill-templates": template,
        "bills": Bill.objects.get(realm=realm),
        "readings": reading,
        "charges": charge,
        "notifications/schedules": schedule,
    }


RESOURCES = [
    "units",
    "payment-methods",
    "beneficiaries",
    "tags",
    "transactions",
    "bill-templates",
    "bills",
    "readings",
    "charges",
    "notifications/schedules",
]


@pytest.mark.parametrize("resource", RESOURCES)
def test_lists_hide_other_realms(api, theirs, resource):
    res = api.get(f"/api/{resource}/", {"date_from": "2000-01-01"})
    assert res.status_code == 200
    ids = {row["id"] for row in res.json()}
    assert theirs[resource].id not in ids
    # Sanity check: the other realm does see its own row through the same endpoint.
    mine = client_for(theirs["user"]).get(f"/api/{resource}/", {"date_from": "2000-01-01"})
    assert theirs[resource].id in {row["id"] for row in mine.json()}


@pytest.mark.parametrize("resource", RESOURCES)
@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_details_of_other_realms_are_not_found(api, theirs, resource, method):
    row = theirs[resource]
    res = getattr(api, method)(f"/api/{resource}/{row.id}/", {}, format="json")
    assert res.status_code == 404
    assert type(row).objects.filter(pk=row.pk).exists()


def test_bill_attachment_of_other_realm_is_not_found(api, theirs):
    assert api.get(f"/api/bills/{theirs['bills'].id}/attachment/").status_code == 404


def test_schedule_test_send_of_other_realm_is_not_found(api, theirs):
    url = f"/api/notifications/schedules/{theirs['notifications/schedules'].id}/test/"
    assert api.post(url).status_code == 404


def test_dashboard_counts_only_this_realm(api, realm, theirs):
    PaymentMethod.objects.create(realm=realm, name="My bank", opening_balance=Decimal("100"))
    data = api.get("/api/dashboard/").json()
    assert data["balance"] == 100
    assert [a["name"] for a in data["accounts"]] == ["My bank"]
    assert data["range"]["income"] == 0


def test_delivery_settings_are_per_realm(api, theirs):
    assert api.get("/api/notifications/settings/").json()["smtp_host"] == ""
    assert api.patch(
        "/api/notifications/settings/", {"smtp_host": "my.mail"}, format="json"
    ).json()["smtp_host"] == ("my.mail")
    assert DeliverySettings.load(theirs["realm"]).smtp_host == "their.mail"


@pytest.fixture
def mine(realm):
    return {
        "unit": RentalUnit.objects.create(realm=realm, name="My unit"),
        "bank": PaymentMethod.objects.create(realm=realm, name="My bank"),
    }


def _tx(mine, **overrides):
    return {
        "kind": "expense",
        "amount": "10",
        "date": "2026-10-01",
        "payment_method": mine["bank"].id,
        **overrides,
    }


@pytest.mark.parametrize(
    "field,key,many",
    [
        ("payment_method", "payment-methods", False),
        ("rental_unit", "units", False),
        ("beneficiary", "beneficiaries", False),
        ("tags", "tags", True),
    ],
)
def test_transactions_cannot_point_at_other_realms(api, mine, theirs, field, key, many):
    value = [theirs[key].id] if many else theirs[key].id
    res = api.post("/api/transactions/", _tx(mine, **{field: value}), format="json")
    assert res.status_code == 400
    assert field in res.json()


def test_transfers_cannot_go_to_other_realms(api, mine, theirs):
    body = _tx(mine, kind="transfer", transfer_to=theirs["savings"].id)
    res = api.post("/api/transactions/", body, format="json")
    assert res.status_code == 400
    assert "transfer_to" in res.json()


def test_bills_cannot_use_other_realms_templates_or_units(api, realm, mine, theirs):
    own_template = BillTemplate.objects.get(realm=realm, is_default=True)
    body = {
        "template": theirs["bill-templates"].id,
        "period": "2026-10-01",
        "account_number": "77",
        "units": [{"rental_unit": mine["unit"].id, "lines": []}],
    }
    assert api.post("/api/bills/", body, format="json").status_code == 400
    body["template"] = own_template.id
    body["units"][0]["rental_unit"] = theirs["units"].id
    assert api.post("/api/bills/", body, format="json").status_code == 400


def test_readings_and_charges_cannot_use_other_realms(api, theirs):
    reading = {"rental_unit": theirs["units"].id, "kind": "water", "period": "2026-01-01"}
    assert api.post("/api/readings/", reading, format="json").status_code == 400
    charge = {
        "rental_unit": theirs["units"].id,
        "category": "levy",
        "period": "2026-01-01",
        "amount": "5",
    }
    assert api.post("/api/charges/", charge, format="json").status_code == 400


def test_charges_cannot_link_other_realms_payments(api, mine, theirs):
    charge = {
        "rental_unit": mine["unit"].id,
        "category": "levy",
        "period": "2026-01-01",
        "amount": "5",
        "transaction": theirs["transactions"].id,
    }
    res = api.post("/api/charges/", charge, format="json")
    assert res.status_code == 400
    assert "transaction" in res.json()


def test_new_rows_land_in_the_request_realm(api, realm, theirs):
    res = api.post("/api/units/", {"name": "Fresh"}, format="json")
    assert res.status_code == 201
    assert RentalUnit.objects.get(pk=res.json()["id"]).realm == realm


def test_names_are_unique_per_realm_not_globally(api, theirs):
    # The other realm already has these names.
    assert api.post("/api/units/", {"name": "Their unit"}, format="json").status_code == 201
    res = api.post("/api/units/", {"name": "Their unit"}, format="json")
    assert res.status_code == 400
    assert "name" in res.json()
    assert api.post("/api/tags/", {"name": "maintenance"}, format="json").status_code == 400


def test_renaming_into_a_clash_is_rejected(api, realm):
    RentalUnit.objects.create(realm=realm, name="A")
    b = RentalUnit.objects.create(realm=realm, name="B")
    assert api.patch(f"/api/units/{b.id}/", {"name": "A"}, format="json").status_code == 400
    assert api.patch(f"/api/units/{b.id}/", {"notes": "x"}, format="json").status_code == 200


def test_bill_account_months_are_unique_per_realm(api, realm, mine, theirs):
    body = {
        "template": BillTemplate.objects.get(realm=realm, is_default=True).id,
        "period": "2026-10-09",
        "account_number": "1001",
        "units": [{"rental_unit": mine["unit"].id, "lines": []}],
    }
    # The other realm has a bill for account 1001 in October too.
    assert api.post("/api/bills/", body, format="json").status_code == 201
    res = api.post("/api/bills/", body, format="json")
    assert res.status_code == 400
    assert "account_number" in res.json()


def test_each_realm_keeps_its_own_default_template(api, realm, theirs):
    custom = api.post(
        "/api/bill-templates/",
        {
            "name": "Mine",
            "is_default": True,
            "definition": BillTemplate.objects.get(realm=realm).definition,
        },
        format="json",
    )
    assert custom.status_code == 201, custom.json()
    assert BillTemplate.objects.get(realm=realm, is_default=True).name == "Mine"
    assert BillTemplate.objects.get(realm=theirs["realm"], is_default=True).is_default


# --- which realm a request works in ------------------------------------------------------


def test_the_realm_header_picks_between_a_users_realms(api, user, realm, theirs):
    RealmMembership.objects.create(user=user, realm=theirs["realm"])
    names = lambda res: {row["name"] for row in res.json()}  # noqa: E731
    assert "Their unit" not in names(api.get("/api/units/"))
    res = api.get("/api/units/", HTTP_X_REALM=str(theirs["realm"].id))
    assert names(res) == {"Their unit"}
    created = api.post(
        "/api/units/", {"name": "Added there"}, format="json", HTTP_X_REALM=str(theirs["realm"].id)
    )
    assert RentalUnit.objects.get(pk=created.json()["id"]).realm == theirs["realm"]


def test_a_realm_the_user_isnt_in_is_refused(api, theirs):
    res = api.get("/api/units/", HTTP_X_REALM=str(theirs["realm"].id))
    assert res.status_code == 403
    assert res.json()["code"] == "not_member"
    assert api.get("/api/units/", HTTP_X_REALM="nonsense").status_code == 403


def test_users_without_a_realm_are_told_so(db):
    loner = get_user_model().objects.create_user("loner", password="pw")
    res = client_for(loner).get("/api/units/")
    assert res.status_code == 403
    assert res.json()["code"] == "no_realm"
    assert client_for(loner).get("/api/dashboard/").status_code == 403


def test_anonymous_requests_are_still_401(db):
    from rest_framework.test import APIClient

    assert APIClient().get("/api/units/").status_code == 401


# --- two-factor sign-in: per account, across realms ------------------------------------------


def test_nobody_else_can_see_or_change_my_security_keys(api, theirs):
    from allauth.mfa.models import Authenticator

    other = get_user_model().objects.get(username="other")
    key = Authenticator.objects.create(
        user=other, type=Authenticator.Type.WEBAUTHN, data={"name": "Their key", "credential": {}}
    )
    assert api.get("/api/auth/mfa/").json()["keys"] == []
    url = f"/api/auth/mfa/keys/{key.pk}/"
    assert api.patch(url, {"name": "Mine now"}, format="json").status_code == 404
    assert api.delete(url, {"password": "pw"}, format="json").status_code == 404
    key.refresh_from_db()
    assert key.data["name"] == "Their key"
