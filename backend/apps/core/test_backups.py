"""Database backups from django-foundation, as wired into rent-tracker. The package's own tests
cover backing up and rolling back; these check this app's settings, admin and middleware."""

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from foundation.backups import maintenance
from rest_framework.test import APIClient


def test_backups_are_set_up(db):
    assert "foundation.backups" in settings.INSTALLED_APPS
    assert settings.BACKUP_FILE_PREFIX == "rent-tracker"
    # Below WhiteNoise, so an open tab can still load the SPA's files and show its page.
    middleware = settings.MIDDLEWARE
    assert middleware.index("foundation.backups.middleware.MaintenanceMiddleware") > (
        middleware.index("whitenoise.middleware.WhiteNoiseMiddleware")
    )


@pytest.mark.parametrize("url", ["/admin/backups/backupschedule/", "/admin/backups/backup/"])
def test_only_superusers_see_backups(db, client, url):
    boss = get_user_model().objects.create_superuser("boss", password="pw")
    client.force_login(boss)
    assert client.get(url).status_code == 200

    # Staff who aren't superusers, realm admins among them, never do: a dump holds every realm.
    staff = get_user_model().objects.create_user("staff", password="pw", is_staff=True)
    client.force_login(staff)
    assert client.get(url).status_code in (302, 403, 404)


def test_while_a_rollback_runs_everything_answers_503(api, client):
    with maintenance.hold():
        res = api.get("/api/units/")
        assert res.status_code == 503
        assert res.json() == {"code": "maintenance", "detail": settings.MAINTENANCE_MESSAGE}
        assert res["Retry-After"]
        # Signing in and refreshing a token too, so nobody's session is thrown away meanwhile.
        refresh = APIClient().post("/api/auth/token/refresh/", {"refresh": "x"}, format="json")
        assert refresh.json()["code"] == "maintenance"
        # The healthcheck says so as well; the SPA asks it when maintenance is over.
        assert APIClient().get("/api/health/").status_code == 503
        assert b"Down for maintenance" in client.get("/admin/").content
    assert api.get("/api/units/").status_code == 200
