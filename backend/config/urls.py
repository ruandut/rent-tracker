from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from foundation.security.login import protect_admin_login

from apps.core.views import spa

# The admin is reachable from the internet too, so its login gets the same captcha as the app's.
protect_admin_login()

# Client-side routes (/transactions etc.) all load the SPA; unknown /api paths stay 404s.
SPA_ROUTE = r"^(?!(?:api|admin|static)(?:/|$)).*$"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.core.urls")),
    path("api/auth/", include("foundation.security.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.realms.urls")),
    path("api/", include("apps.ledger.urls")),
    path("api/", include("apps.bills.urls")),
    path("api/", include("apps.utilities.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
]

if settings.SPA_INDEX.exists():
    urlpatterns.append(re_path(SPA_ROUTE, spa))
