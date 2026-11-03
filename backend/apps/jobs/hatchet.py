"""One Hatchet client per process, created on first use.

Lazy so `manage.py migrate` etc. work before you've generated a HATCHET_CLIENT_TOKEN.
The SDK reads its config from env vars (HATCHET_CLIENT_TOKEN, HATCHET_CLIENT_TLS_STRATEGY),
which settings.py loads from backend/.env.
"""

from functools import cache

from hatchet_sdk import Hatchet


@cache
def get_hatchet() -> Hatchet:
    return Hatchet()
