"""The running release, shown under the SPA's user menu."""

import tomllib
from pathlib import Path

from rest_framework.test import APIClient

PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


def test_me_says_which_release_and_commit_runs(api, settings):
    version = tomllib.loads(PYPROJECT.read_text())["project"]["version"]
    assert api.get("/api/auth/me/").json()["app"] == {"version": version, "commit": None}

    settings.APP_COMMIT = "abc1234"
    assert api.get("/api/auth/me/").json()["app"]["commit"] == "abc1234"


def test_the_public_healthcheck_doesnt_say(db):
    assert "app" not in APIClient().get("/api/health/").json()
