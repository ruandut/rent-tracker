"""ALTCHA proof-of-work captcha on the sign-in routes (login, register, the admin's login).

The SPA's widget fetches a challenge from `challenge`, solves it in the browser and sends the
payload as `altcha` with the form. `verify` checks it: the HMAC signature, expiry, single use
(django-altcha keeps used challenges in the default cache, which lives in Postgres) and that at
least CAPTCHA_MIN_SECONDS passed since the challenge was issued. The issue time sits in the
challenge's salt, which the hash and signature cover, so a bot can't backdate it: every attempt
costs a fresh challenge and a few seconds, however fast it can solve one.
"""

import base64
import datetime
import json
import time
from urllib.parse import parse_qs

import altcha
from django import forms
from django.conf import settings
from django.contrib.admin.forms import AdminAuthenticationForm
from django.forms import ValidationError as DjangoValidationError
from django.http import JsonResponse
from django_altcha import AltchaField, get_hmac_key
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from apps.core.throttling import CaptchaThrottle, with_defaults

ISSUED_PARAM = "issued"
TOO_FAST = "That was too quick. Wait a moment and try again."


def new_challenge() -> altcha.Challenge:
    now = datetime.datetime.now(datetime.UTC)
    return altcha.create_challenge(
        altcha.ChallengeOptions(
            hmac_key=get_hmac_key(),
            max_number=settings.CAPTCHA_MAX_NUMBER,
            expires=now + datetime.timedelta(milliseconds=settings.ALTCHA_CHALLENGE_EXPIRE),
            params={ISSUED_PARAM: str(int(now.timestamp() * 1000))},
        )
    )


class ChallengeView(APIView):
    """GET /api/auth/captcha/: a fresh challenge. Public, and holds nothing about any realm."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = with_defaults(CaptchaThrottle)

    def get(self, request):
        response = JsonResponse(new_challenge().__dict__)
        # Each one is single-use, so no cache may hand the same challenge out twice.
        response["Cache-Control"] = "no-store"
        return response


def issued_at(payload: str) -> float | None:
    """When the payload's challenge was issued, in epoch seconds, or None if it doesn't say."""
    try:
        salt = json.loads(base64.b64decode(payload))["salt"]
        return int(parse_qs(salt.split("?", 1)[1])[ISSUED_PARAM][0]) / 1000
    except ValueError, KeyError, IndexError, TypeError:
        return None


def check(payload: str | None) -> None:
    """Raises Django's ValidationError unless `payload` solves an unused challenge of ours that
    was issued at least CAPTCHA_MIN_SECONDS ago."""
    if not settings.ALTCHA_VERIFICATION_ENABLED:
        return
    if not payload:
        raise DjangoValidationError("Complete the captcha first.", code="required")
    # Verifies the signature and marks the challenge used, so a too-quick payload is spent too.
    AltchaField().clean(payload)
    issued = issued_at(payload)
    if issued is None:
        # Signed by us but without an issue time: not one of our challenges.
        raise DjangoValidationError("Invalid CAPTCHA token.", code="invalid")
    if time.time() - issued < settings.CAPTCHA_MIN_SECONDS:
        raise DjangoValidationError(TOO_FAST, code="too_fast")


def verify(request) -> None:
    """DRF flavour of `check`: errors come back as 400 {"altcha": ["…"]}."""
    try:
        check(request.data.get("altcha"))
    except DjangoValidationError as e:
        raise ValidationError({"altcha": e.messages}) from e


class AdminLoginForm(AdminAuthenticationForm):
    """The Django admin's login, with the same captcha. django-altcha renders its own widget."""

    altcha = forms.CharField(
        required=False,
        # django-altcha's bundled widget (v2) calls the minimum time `delay`, in milliseconds.
        widget=AltchaField(
            challengeurl="/api/auth/captcha/", hidefooter=True, auto="onload", delay=3500
        ).widget,
    )

    def clean(self):
        # Before the password check, so wrong guesses spend captchas too.
        try:
            check(self.data.get("altcha"))
        except DjangoValidationError as e:
            raise forms.ValidationError(e.messages, code=e.code) from e
        return super().clean()
