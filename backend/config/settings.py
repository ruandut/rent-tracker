"""Django settings. Everything environment-specific comes from backend/.env (see .env.example)."""

import hashlib
import hmac
from datetime import timedelta
from pathlib import Path

import environ
from corsheaders.defaults import default_headers
from django.utils.csp import CSP

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DEBUG=(bool, False))
# read_env also exports values into os.environ, which is how the Hatchet SDK finds
# HATCHET_CLIENT_TOKEN / HATCHET_CLIENT_TLS_STRATEGY / HATCHET_CLIENT_HOST_PORT.
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "django_altcha",
    # Platform apps: shared plumbing, no product features.
    "apps.core",
    "apps.accounts",
    "apps.realms",
    "apps.jobs",
    # Domain apps. Imports run one way: utilities -> bills -> ledger.
    "apps.ledger",
    "apps.bills",
    "apps.utilities",
    "apps.notifications",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Above WhiteNoise, so the files it serves get these headers too.
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
    "apps.core.middleware.PermissionsPolicyMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}

# There's no Redis: the cache is a Postgres table (created by apps/core/migrations), shared by
# every worker. It holds rate-limit counters and used captcha challenges, so it must not cull
# entries early: a culled challenge could be replayed.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "django_cache",
        "OPTIONS": {"MAX_ENTRIES": 50_000},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-za"
TIME_ZONE = "Africa/Johannesburg"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# The built frontend, present only in the production image. WhiteNoise serves its files from
# the site root; config/urls.py sends every other path to its index.html.
SPA_ROOT = BASE_DIR / "spa"
SPA_INDEX = SPA_ROOT / "index.html"
if SPA_INDEX.exists():
    WHITENOISE_ROOT = SPA_ROOT

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- API -------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    # InRealm resolves the request's realm (apps/realms/permissions.py). Endpoints that work across
    # realms, or before sign-in, set their own permission classes.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
        "apps.realms.permissions.InRealm",
    ],
    "COERCE_DECIMAL_TO_STRING": False,
    # Every endpoint: per account once signed in, per IP on the public routes (login, refresh,
    # register; DRF rejects other anonymous requests before counting). The sign-in routes add
    # the stricter "auth" limit (apps/core/throttling.py). A busy screen makes a dozen requests.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON", default="120/min"),
        "user": env("THROTTLE_USER", default="1200/min"),
        "auth": env("THROTTLE_AUTH", default="10/min"),
        "captcha": env("THROTTLE_CAPTCHA", default="30/min"),
    },
    # How many proxies in front of Django append to X-Forwarded-For. 0 trusts only the socket's
    # address, which can't be spoofed; behind one reverse proxy or tunnel, set 1. Too low and
    # everyone shares the proxy's limit; too high and clients can pick their own IP.
    "NUM_PROXIES": env.int("NUM_PROXIES", default=0),
}
if not DEBUG:
    # No browsable API in production: JSON only.
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = ["rest_framework.renderers.JSONRenderer"]

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
}

# The Vite dev server proxies /api, so CORS only matters if you hit Django directly.
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5174"])
CORS_ALLOW_HEADERS = (*default_headers, "x-realm")
# Needed for the Django admin when it isn't on localhost.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# --- Captcha ---------------------------------------------------------------
# ALTCHA proof of work on login, register and the admin login (apps/accounts/captcha.py).
# CAPTCHA_ENABLED=false skips verification, e.g. in tests; the widget still runs.
ALTCHA_VERIFICATION_ENABLED = env.bool("CAPTCHA_ENABLED", default=True)
# Signs challenges. Generate with: openssl rand -hex 32. Without one, a key is derived from
# DJANGO_SECRET_KEY, so an install whose Compose file predates this setting keeps working.
ALTCHA_HMAC_KEY = (
    env("ALTCHA_HMAC_KEY", default="")
    or hmac.new(SECRET_KEY.encode(), b"rent-tracker.altcha", hashlib.sha256).hexdigest()
)
ALTCHA_CHALLENGE_EXPIRE = 20 * 60 * 1000  # ms, altcha's recommended 20 minutes
# A challenge can't be redeemed until this long after it was issued, however fast it's solved.
# The SPA's widget waits a little longer (CAPTCHA_MIN_MS in frontend/src/components/altcha.tsx).
CAPTCHA_MIN_SECONDS = 3
# Proof-of-work difficulty: the solver tries up to this many SHA-256 hashes. A 2025 laptop does
# ~500k/s per core and the widget uses several, so the 3 s floor, not this, sets the wait.
CAPTCHA_MAX_NUMBER = 500_000

# --- Security headers ------------------------------------------------------
# The app is meant to face the internet. SecurityMiddleware already sends nosniff,
# Referrer-Policy: same-origin and Cross-Origin-Opener-Policy: same-origin; X-Frame-Options is
# DENY. The CSP keeps scripts to this origin, so injected markup can't run code or post data
# elsewhere (the JWTs sit in localStorage). Styles stay inline-friendly: React style props,
# Radix and the captcha widget all set them, and inline CSS can't run code.
SECURE_CSP = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF],
    "style-src": [CSP.SELF, CSP.UNSAFE_INLINE],
    # Bill files are previewed from blob: URLs; the captcha solves in blob: workers.
    "img-src": [CSP.SELF, "data:", "blob:"],
    "font-src": [CSP.SELF, "data:"],
    "connect-src": [CSP.SELF],
    "worker-src": [CSP.SELF, "blob:"],
    "frame-src": [CSP.SELF, "blob:"],
    "object-src": [CSP.NONE],
    "base-uri": [CSP.SELF],
    "form-action": [CSP.SELF],
    "frame-ancestors": [CSP.NONE],
}
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# Set HTTPS=true once the site is served over https (usually by a proxy or tunnel in front).
# Cookies (admin only; the SPA uses JWTs) become https-only and browsers are told to stick to
# https. Redirecting http to https is the proxy's job: the healthcheck and LAN use plain http.
HTTPS = env.bool("HTTPS", default=False)
if HTTPS:
    SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    if REST_FRAMEWORK["NUM_PROXIES"]:
        # Only trust the proxy's word that the request came over https when there is one.
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_HTTPONLY = True

# --- Email -----------------------------------------------------------------
# Realm invitations. Summaries use each realm's own mail server instead (notifications app).
# Unset, invitations are only printed to the log; admins can still copy an invite's link.
# e.g. EMAIL_URL=smtp+tls://user:password@smtp.example.com:587
if env("EMAIL_URL", default=""):
    vars().update(env.email_url("EMAIL_URL"))
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Rent Tracker <noreply@localhost>")
