"""Encrypts delivery credentials at rest, so they aren't readable in the database or a backup.

The key is derived from DJANGO_SECRET_KEY, so there is no extra secret to manage. Changing that
key makes stored credentials unreadable; they then just need entering again.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


class UnreadableSecret(Exception):
    pass


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"notifications:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise UnreadableSecret from exc
