from django.urls import include, path
from foundation.mfa import urls as mfa_urls
from foundation.security.views import LoginView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.views import TokenRefreshView

from . import views


def account_wide(pattern):
    """foundation.mfa's route with only IsAuthenticated: 2FA belongs to the account, not a realm,
    so the default InRealm permission must not refuse someone who has no realm (or whose tab names
    one they just left). The public second step of signing in stays AllowAny."""
    view = pattern.callback.cls
    if AllowAny in view.permission_classes:
        return pattern
    return path(
        str(pattern.pattern),
        view.as_view(**pattern.callback.initkwargs, permission_classes=[IsAuthenticated]),
        name=pattern.name,
    )


urlpatterns = [
    # The captcha's challenge, captcha/, comes from foundation.security.urls (config/urls.py).
    # For someone with 2FA, token/ answers {"mfa_required", "mfa_token", "methods"} instead of
    # tokens, and mfa/login/ finishes signing in.
    path("token/", LoginView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", views.me, name="me"),
    # Two-factor sign-in: your own app, keys and recovery codes, and the second step of signing in.
    path("mfa/", include([account_wide(p) for p in mfa_urls.urlpatterns])),
]
