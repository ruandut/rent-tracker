"""Rate limits. DRF keeps the counters in the default cache, which is a Postgres table here
(there's no Redis), so they hold across every gunicorn worker and survive restarts.

Every API request already passes AnonRateThrottle (per IP) and UserRateThrottle (per account),
from REST_FRAMEWORK in settings. The classes below add stricter per-IP limits to the public
sign-in routes; views list them on top of the defaults with `with_defaults`.
"""

from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle


class IPRateThrottle(SimpleRateThrottle):
    """Counts per client IP whether or not the request is signed in. The IP comes from
    REMOTE_ADDR, or X-Forwarded-For when NUM_PROXIES says how many proxies to trust."""

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class AuthThrottle(IPRateThrottle):
    """Login, register, invitation lookups: password guessing and token probing."""

    scope = "auth"


class CaptchaThrottle(IPRateThrottle):
    """Challenge requests. Cheap to serve, but nobody needs many."""

    scope = "captcha"


def with_defaults(*extra):
    return [*api_settings.DEFAULT_THROTTLE_CLASSES, *extra]
