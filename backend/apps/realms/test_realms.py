"""Realm management: creating, switching, members, leaving, deleting and invitations."""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.bills.models import Bill, BillTemplate
from apps.ledger.models import PaymentMethod, RentalUnit, Tag, Transaction
from apps.notifications import services as notification_services
from apps.notifications.models import DeliverySettings, SummarySchedule
from apps.realms.models import Profile, Realm, RealmInvitation, RealmMembership
from apps.realms.services import create_realm
from conftest import client_for

User = get_user_model()


@pytest.fixture(autouse=True)
def _mail(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


def make_user(name, email=""):
    return User.objects.create_user(name, email=email, password="pw")


def join(user, realm, role="member"):
    return RealmMembership.objects.create(user=user, realm=realm, role=role)


# --- me ------------------------------------------------------------------------------------


def test_me_describes_the_current_realm_and_the_others(api, user, realm):
    second = create_realm(user, "Another")
    data = api.get("/api/auth/me/").json()
    # Creating a realm focuses it.
    assert data["realm"] == {"id": second.id, "name": "Another", "role": "admin"}
    assert [r["name"] for r in data["realms"]] == ["Another", "Test realm"]
    data = api.get("/api/auth/me/", HTTP_X_REALM=str(realm.id)).json()
    assert data["realm"]["id"] == realm.id


def test_me_without_a_realm(db):
    loner = make_user("loner")
    data = client_for(loner).get("/api/auth/me/").json()
    assert data["realm"] is None and data["realms"] == []


# --- creating and changing realms ----------------------------------------------------------


def test_creating_a_realm_sets_it_up_and_makes_you_admin(api, user):
    res = api.post("/api/realms/", {"name": "  Beach house "}, format="json")
    assert res.status_code == 201
    realm = Realm.objects.get(pk=res.json()["id"])
    assert realm.name == "Beach house"
    assert res.json()["role"] == "admin"
    assert Tag.objects.filter(realm=realm, name="maintenance", is_system=True).exists()
    assert BillTemplate.objects.get(realm=realm).is_default
    assert Profile.of(user).focused_realm == realm


def test_a_user_with_no_realm_can_create_one(db):
    loner = make_user("loner")
    assert client_for(loner).post("/api/realms/", {"name": "Mine"}).status_code == 201
    assert client_for(loner).get("/api/units/").status_code == 200


def test_list_shows_only_your_realms(api, realm):
    create_realm(make_user("other"), "Not yours")
    rows = api.get("/api/realms/").json()
    assert [(r["name"], r["role"], r["member_count"]) for r in rows] == [("Test realm", "admin", 1)]


def test_other_realms_are_not_found(api):
    theirs = create_realm(make_user("other"), "Not yours")
    for method, path in [
        ("get", ""),
        ("patch", ""),
        ("delete", ""),
        ("post", "switch/"),
        ("post", "leave/"),
        ("get", "members/"),
        ("get", "invitations/"),
    ]:
        res = getattr(api, method)(f"/api/realms/{theirs.id}/{path}", {}, format="json")
        assert res.status_code == 404, (method, path)


def test_switch_sets_the_focus(api, user, realm):
    other = create_realm(user, "Second")
    assert api.post(f"/api/realms/{realm.id}/switch/").status_code == 200
    assert Profile.of(user).focused_realm == realm
    assert api.post(f"/api/realms/{other.id}/switch/").status_code == 200
    assert Profile.of(user).focused_realm == other


def test_only_admins_rename(api, realm):
    member = make_user("member")
    join(member, realm)
    res = client_for(member).patch(f"/api/realms/{realm.id}/", {"name": "X"}, format="json")
    assert res.status_code == 403
    res = api.patch(f"/api/realms/{realm.id}/", {"name": "Renamed"}, format="json")
    assert res.json()["name"] == "Renamed"


# --- members -------------------------------------------------------------------------------


@pytest.fixture
def member(realm):
    person = make_user("member", "member@example.com")
    join(person, realm)
    return person


def test_members_list_is_for_members(api, realm, member):
    rows = client_for(member).get(f"/api/realms/{realm.id}/members/").json()
    assert [(r["username"], r["role"]) for r in rows] == [("tester", "admin"), ("member", "member")]


def test_admins_change_roles_but_keep_one_admin(api, user, realm, member):
    url = f"/api/realms/{realm.id}/members/"
    assert client_for(member).patch(f"{url}{user.id}/", {"role": "member"}).status_code == 403
    assert api.patch(f"{url}{user.id}/", {"role": "member"}).status_code == 400
    assert api.patch(f"{url}{member.id}/", {"role": "admin"}).json()["role"] == "admin"
    assert api.patch(f"{url}{user.id}/", {"role": "member"}).status_code == 200
    assert api.patch(f"{url}{member.id}/", {"role": "owner"}).status_code == 403  # no longer admin


def test_admins_remove_members(api, realm, member):
    Profile.objects.update_or_create(user=member, defaults={"focused_realm": realm})
    assert api.delete(f"/api/realms/{realm.id}/members/{member.id}/").status_code == 204
    assert not RealmMembership.objects.filter(user=member).exists()
    assert Profile.of(member).focused_realm is None
    assert client_for(member).get("/api/units/").status_code == 403


def test_admins_remove_themselves_by_leaving(api, user, realm):
    assert api.delete(f"/api/realms/{realm.id}/members/{user.id}/").status_code == 400


# --- leaving and deleting ------------------------------------------------------------------


def test_the_only_member_cannot_leave(api, realm):
    assert api.post(f"/api/realms/{realm.id}/leave/").status_code == 400


def test_members_leave(realm, member):
    assert client_for(member).post(f"/api/realms/{realm.id}/leave/").status_code == 204
    assert not RealmMembership.objects.filter(user=member, realm=realm).exists()


def test_the_last_admin_hands_over_before_leaving(api, user, realm, member):
    url = f"/api/realms/{realm.id}/leave/"
    assert api.post(url).status_code == 400
    assert api.post(url, {"new_admin": 99999}).status_code == 400
    assert api.post(url, {"new_admin": member.id}).status_code == 204
    assert RealmMembership.objects.get(realm=realm).user == member
    assert RealmMembership.objects.get(realm=realm).is_admin


def test_deleting_needs_the_name_and_removes_everything(api, user, realm, member):
    bank = PaymentMethod.objects.create(realm=realm, name="Bank")
    unit = RentalUnit.objects.create(realm=realm, name="Unit")
    Transaction.objects.create(
        realm=realm,
        kind="income",
        amount=Decimal("1"),
        date=date.today(),
        payment_method=bank,
        rental_unit=unit,
    )
    api.post(
        "/api/bills/",
        {
            "template": BillTemplate.objects.get(realm=realm).id,
            "period": "2026-10-01",
            "account_number": "1",
            "units": [{"rental_unit": unit.id, "lines": []}],
        },
        format="json",
    )
    assert Bill.objects.filter(realm=realm).exists()
    keep = create_realm(make_user("other"), "Survivor")
    PaymentMethod.objects.create(realm=keep, name="Bank")

    url = f"/api/realms/{realm.id}/"
    assert client_for(member).delete(url, {"confirm": "Test realm"}).status_code == 403
    assert api.delete(url, {"confirm": "wrong"}).status_code == 400
    assert api.delete(url, {"confirm": "Test realm"}).status_code == 204
    assert not Realm.objects.filter(pk=realm.pk).exists()
    assert not PaymentMethod.objects.filter(name="Bank").exclude(realm=keep).exists()
    assert PaymentMethod.objects.filter(realm=keep).exists()
    assert Profile.of(user).focused_realm is None


# --- invitations ---------------------------------------------------------------------------


def test_only_admins_invite(realm, member):
    url = f"/api/realms/{realm.id}/invitations/"
    assert client_for(member).post(url, {"email": "x@example.com"}).status_code == 403
    assert client_for(member).get(url).status_code == 403


def test_inviting_a_new_address_emails_a_register_link(api, realm):
    res = api.post(
        f"/api/realms/{realm.id}/invitations/", {"email": "New@Example.com"}, format="json"
    )
    assert res.status_code == 201, res.json()
    data = res.json()
    invitation = RealmInvitation.objects.get()
    assert invitation.email == "new@example.com"
    assert data["email_sent"] is True
    assert data["link"].endswith(f"/register?invite={invitation.token}")
    assert mail.outbox[0].to == ["new@example.com"]
    assert data["link"] in mail.outbox[0].body
    # The admin can see it, and its link, until it's answered.
    assert api.get(f"/api/realms/{realm.id}/invitations/").json()[0]["link"] == data["link"]


def test_an_address_with_an_account_is_invited_in_app(api, realm):
    make_user("known", "known@example.com")
    api.post(f"/api/realms/{realm.id}/invitations/", {"email": "known@example.com"})
    assert "/register" not in mail.outbox[0].body
    assert "/realms" in mail.outbox[0].body


def test_failed_email_still_creates_the_invitation(api, realm):
    with patch("apps.realms.services.send_mail", side_effect=OSError("no server")):
        res = api.post(f"/api/realms/{realm.id}/invitations/", {"email": "x@example.com"})
    assert res.status_code == 201
    assert res.json()["email_sent"] is False
    assert res.json()["link"]


def test_duplicate_invitations_and_members_are_refused(api, realm, member):
    url = f"/api/realms/{realm.id}/invitations/"
    assert api.post(url, {"email": "member@example.com"}).status_code == 400
    assert api.post(url, {"email": "x@example.com"}).status_code == 201
    assert api.post(url, {"email": "X@example.com"}).status_code == 400


def test_admins_cancel_invitations(api, realm):
    url = f"/api/realms/{realm.id}/invitations/"
    invitation_id = api.post(url, {"email": "x@example.com"}).json()["id"]
    assert api.delete(f"{url}{invitation_id}/").status_code == 204
    assert not RealmInvitation.objects.exists()


@pytest.fixture
def invited(api, realm):
    """Someone with an account, invited by email."""
    person = make_user("invitee", "invitee@example.com")
    api.post(f"/api/realms/{realm.id}/invitations/", {"email": "invitee@example.com"})
    return person


def test_received_invitations_are_matched_by_email(api, realm, invited):
    rows = client_for(invited).get("/api/realms/received/").json()
    assert [(r["realm_name"], r["invited_by"]) for r in rows] == [("Test realm", "tester")]
    assert client_for(invited).get("/api/auth/me/").json()["pending_invitations"] == 1
    # Nobody else sees it.
    assert api.get("/api/realms/received/").json() == []


def test_accepting_joins_and_focuses(realm, invited):
    client = client_for(invited)
    invitation = RealmInvitation.objects.get()
    assert client.post(f"/api/realms/received/{invitation.id}/accept/").status_code == 200
    assert RealmMembership.objects.get(user=invited).realm == realm
    assert Profile.of(invited).focused_realm == realm
    assert client.get("/api/units/").status_code == 200
    assert client.post(f"/api/realms/received/{invitation.id}/accept/").status_code == 404


def test_rejecting_doesnt_join(realm, invited):
    invitation = RealmInvitation.objects.get()
    client = client_for(invited)
    assert client.post(f"/api/realms/received/{invitation.id}/reject/").status_code == 204
    assert not RealmMembership.objects.filter(user=invited).exists()
    assert RealmInvitation.objects.get().status == "rejected"


def test_someone_elses_invitation_cannot_be_accepted(realm, invited):
    stranger = make_user("stranger", "stranger@example.com")
    invitation = RealmInvitation.objects.get()
    res = client_for(stranger).post(f"/api/realms/received/{invitation.id}/accept/")
    assert res.status_code == 404


@pytest.fixture
def invitation(api, realm):
    api.post(f"/api/realms/{realm.id}/invitations/", {"email": "fresh@example.com"})
    return RealmInvitation.objects.get()


def test_the_invite_link_shows_who_invited_you_without_signing_in(invitation):
    res = APIClient().get(f"/api/auth/invitations/{invitation.token}/")
    assert res.json() == {
        "realm_name": "Test realm",
        "email": "fresh@example.com",
        "invited_by": "tester",
        "has_account": False,
    }


def test_registering_from_an_invite_joins_only_that_realm(realm, invitation):
    res = APIClient().post(
        "/api/auth/register/",
        {"invite": str(invitation.token), "username": "fresh", "password": "a-long-passphrase"},
        format="json",
    )
    assert res.status_code == 201, res.json()
    user = User.objects.get(username="fresh")
    assert user.email == "fresh@example.com"
    assert [m.realm for m in RealmMembership.objects.filter(user=user)] == [realm]
    assert RealmMembership.objects.get(user=user).role == "member"
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")
    assert client.get("/api/units/").status_code == 200
    # The link only works once.
    again = APIClient().post(
        "/api/auth/register/",
        {"invite": str(invitation.token), "username": "again", "password": "a-long-passphrase"},
        format="json",
    )
    assert again.status_code == 404


def test_registering_checks_the_password_and_username(realm, invitation, user):
    def post(username, password):
        return APIClient().post(
            "/api/auth/register/",
            {"invite": str(invitation.token), "username": username, "password": password},
            format="json",
        )

    assert post("fresh", "123").status_code == 400
    assert post("Tester", "a-long-passphrase").status_code == 400
    assert not User.objects.filter(username="fresh").exists()


def test_there_is_no_open_sign_up(db):
    res = APIClient().post(
        "/api/auth/register/",
        {
            "invite": "00000000-0000-0000-0000-000000000000",
            "username": "x",
            "password": "a-long-passphrase",
        },
        format="json",
    )
    assert res.status_code == 404


# --- summaries and the first admin --------------------------------------------------------


def test_summaries_use_their_own_realm(realm):
    other = create_realm(make_user("other"), "Other books")
    for each, balance in [(realm, "100"), (other, "999")]:
        PaymentMethod.objects.create(realm=each, name="Bank", opening_balance=Decimal(balance))
        SummarySchedule.objects.create(
            realm=each,
            name="Now",
            channel="email",
            recipient="me@example.com",
            frequency="monthly",
            start_at="2020-01-01T08:00:00Z",
            next_run_at="2020-01-01T08:00:00Z",
        )
    DeliverySettings.objects.create(realm=other, smtp_host="other.mail")
    sent = []
    with patch.object(
        notification_services,
        "deliver",
        lambda s, subj, body: sent.append(
            (s.realm.name, subj, body, DeliverySettings.load(s.realm).smtp_host)
        ),
    ):
        assert notification_services.send_due_summaries() == {"sent": 2, "failed": 0}
    by_realm = {name: (subject, body, host) for name, subject, body, host in sent}
    assert "R 100.00" in by_realm["Test realm"][1] and "999" not in by_realm["Test realm"][1]
    assert "R 999.00" in by_realm["Other books"][1]
    assert "Other books" in by_realm["Other books"][0]
    assert by_realm["Other books"][2] == "other.mail"


def test_the_first_admin_gets_a_realm(db, monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "ruan")
    monkeypatch.setenv("ADMIN_PASSWORD", "pw")
    call_command("bootstrap_admin")
    call_command("bootstrap_admin")
    membership = RealmMembership.objects.get(user__username="ruan")
    assert membership.is_admin and membership.realm.name == "My rentals"
    assert Realm.objects.count() == 1
