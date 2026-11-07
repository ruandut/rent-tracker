import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.realms.services import create_realm


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user("tester", email="tester@example.com", password="pw")


@pytest.fixture
def realm(user):
    """The tester's realm, set up like any new realm (the maintenance tag, the George template)."""
    return create_realm(user, "Test realm")


def client_for(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def api(user, realm):
    return client_for(user)
