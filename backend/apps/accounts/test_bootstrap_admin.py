import pytest
from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command


def test_creates_admin_once_and_never_resets_password(db, monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", "ruan")
    monkeypatch.setenv("ADMIN_PASSWORD", "first")
    call_command("bootstrap_admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "second")
    call_command("bootstrap_admin")
    user = get_user_model().objects.get(username="ruan")
    assert user.is_superuser
    assert user.check_password("first")


def test_requires_credentials(db, monkeypatch):
    monkeypatch.delenv("ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    with pytest.raises(CommandError):
        call_command("bootstrap_admin")
