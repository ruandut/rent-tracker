import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


@pytest.fixture
def api(db):
    user = get_user_model().objects.create_user("tester", password="pw")
    client = APIClient()
    client.force_authenticate(user)
    return client
