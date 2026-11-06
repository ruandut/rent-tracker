import re

import pytest
from django.test import RequestFactory

from apps.core.views import spa
from config.urls import SPA_ROUTE


@pytest.mark.parametrize("path", ["", "login", "transactions", "payment-methods/", "favicon.ico"])
def test_spa_route_catches_client_routes(path):
    assert re.match(SPA_ROUTE, path)


@pytest.mark.parametrize("path", ["api/nope/", "api", "admin", "admin/login/", "static/x.css"])
def test_spa_route_leaves_server_routes_alone(path):
    assert not re.match(SPA_ROUTE, path)


def test_spa_view_serves_index_uncached(settings, tmp_path):
    settings.SPA_INDEX = tmp_path / "index.html"
    settings.SPA_INDEX.write_text("<title>Rent Tracker</title>")
    res = spa(RequestFactory().get("/transactions"))
    assert b"".join(res.streaming_content) == b"<title>Rent Tracker</title>"
    assert res["Content-Type"] == "text/html"
    assert "no-cache" in res["Cache-Control"]
