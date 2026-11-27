"""Two-factor sign-in from django-foundation, as wired into rent-tracker. The package's own tests
cover each flow; these check this app's routes, its realm rules and its admin login.

App codes are computed from the real secret, as a phone would.
"""

import time

import pytest
from allauth.mfa.totp.internal.auth import format_hotp_value, hotp_value
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from conftest import client_for

MFA = "/api/auth/mfa/"


@pytest.fixture(autouse=True)
def _generous_limits(monkeypatch):
    # DRF copies the rates onto the class at import, so settings overrides don't reach them.
    monkeypatch.setattr(
        SimpleRateThrottle,
        "THROTTLE_RATES",
        {**SimpleRateThrottle.THROTTLE_RATES, "auth": "1000/min", "mfa": "1000/min"},
    )


def code(secret: str) -> str:
    return format_hotp_value(hotp_value(secret, int(time.time()) // 30))


def set_up_app(client) -> tuple[str, list[str]]:
    secret = client.post(MFA + "totp/setup/").json()["secret"]
    res = client.post(MFA + "totp/", {"code": code(secret), "password": "pw"})
    assert res.status_code == 201, res.content
    return secret, res.json()["recovery_codes"]


def sign_in(username="tester", password="pw"):
    return APIClient().post(
        "/api/auth/token/", {"username": username, "password": password}, format="json"
    )


def test_mfa_is_set_up(db):
    assert "foundation.mfa" in settings.INSTALLED_APPS
    assert settings.MFA_TOTP_ISSUER == "Rent Tracker"


def test_signing_in_with_an_app_code_then_using_the_app(api, realm):
    secret, recovery = set_up_app(api)
    assert len(recovery) == 10

    first = sign_in()
    assert first.status_code == 200
    body = first.json()
    assert body["mfa_required"] is True
    assert "access" not in body and "refresh" not in body

    res = APIClient().post(
        MFA + "login/", {"mfa_token": body["mfa_token"], "code": code(secret)}, format="json"
    )
    assert res.status_code == 200, res.content
    tokens = res.json()

    # The tokens work like any others: the realm's data, and refreshing.
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert client.get("/api/units/").status_code == 200
    refreshed = APIClient().post(
        "/api/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json"
    )
    assert refreshed.status_code == 200


def test_a_recovery_code_signs_in_once(api):
    _, recovery = set_up_app(api)
    for expected in (200, 400):
        token = sign_in().json()["mfa_token"]
        res = APIClient().post(
            MFA + "login/", {"mfa_token": token, "code": recovery[0]}, format="json"
        )
        assert res.status_code == expected


def test_without_2fa_sign_in_gives_tokens_straight_away(user):
    assert set(sign_in().json()) == {"access", "refresh"}


def test_2fa_belongs_to_the_account_not_a_realm(db, user, realm):
    # Someone in no realm (InRealm would answer "no_realm") still manages their 2FA.
    loner = get_user_model().objects.create_user("loner", password="pw")
    assert client_for(loner).get("/api/units/").status_code == 403
    set_up_app(client_for(loner))
    assert client_for(loner).get(MFA).json()["enabled"] is True

    # A tab naming a realm the person isn't in doesn't stop them either.
    res = client_for(user).get(MFA, HTTP_X_REALM="999999")
    assert res.status_code == 200
    assert res.json()["enabled"] is False

    # Signed out, it's 401 as everywhere else.
    assert APIClient().get(MFA).status_code == 401


def test_i_only_see_and_change_my_own_factors(api, user):
    other = get_user_model().objects.create_user("other", password="pw")
    set_up_app(client_for(other))
    assert api.get(MFA).json()["totp"] is None
    # Removing "the" app removes only mine, of which there is none.
    assert api.delete(MFA + "totp/", {"password": "pw"}, format="json").status_code == 404
    assert client_for(other).get(MFA).json()["enabled"] is True


def test_the_admin_login_asks_for_the_code(db, client):
    boss = get_user_model().objects.create_superuser("boss", password="pw")
    secret, _ = set_up_app(client_for(boss))
    res = client.post("/admin/login/", {"username": "boss", "password": "pw"})
    assert res.status_code == 200  # the form again, with an error
    assert "_auth_user_id" not in client.session
    res = client.post("/admin/login/", {"username": "boss", "password": "pw", "code": code(secret)})
    assert res.status_code == 302
