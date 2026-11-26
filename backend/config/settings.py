"""Django settings. Everything environment-specific comes from backend/.env (see .env.example)."""

from datetime import timedelta
from pathlib import Path

import environ
from corsheaders.defaults import default_headers
from foundation import settings as foundation

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
    # Shared plumbing from django-foundation: Hatchet jobs, the captcha, rate limits, headers.
    "foundation.jobs",
    "foundation.security",
    # Platform apps: shared plumbing, no product features.
    "apps.core",
    "apps.accounts",
    "apps.realms",
    # Domain apps. Imports run one way: utilities -> bills -> ledger.
    "apps.ledger",
    "apps.bills",
    "apps.utilities",
    "apps.notifications",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # CSP and Permissions-Policy. Above WhiteNoise, so the files it serves get them too.
    *foundation.SECURITY_MIDDLEWARE,
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
    # Rate limits per account and per IP, NUM_PROXIES, and JSON only outside DEBUG.
    **foundation.rest_framework(env, debug=DEBUG),
}

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

# --- Captcha, cache and security headers ----------------------------------
# From django-foundation (foundation/settings.py): the Postgres cache table that holds rate-limit
# counters and used challenges (there's no Redis), the ALTCHA captcha on login, register and the
# admin's login, the Content Security Policy and other headers, and HTTPS=true's secure cookies
# and HSTS. Without ALTCHA_HMAC_KEY the captcha's key is derived from DJANGO_SECRET_KEY.
# The SPA's widget must wait a little longer than CAPTCHA_MIN_SECONDS (3 s): CAPTCHA_MIN_MS in
# frontend/src/components/altcha.tsx.
globals().update(foundation.security(env, secret_key=SECRET_KEY))

# The worker's name in Hatchet's dashboard (manage.py hatchet_worker, from foundation.jobs).
HATCHET_WORKER_NAME = "rent-tracker-worker"

# --- Email -----------------------------------------------------------------
# Realm invitations. Summaries use each realm's own mail server instead (notifications app).
# Unset, invitations are only printed to the log; admins can still copy an invite's link.
# e.g. EMAIL_URL=smtp+tls://user:password@smtp.example.com:587
if env("EMAIL_URL", default=""):
    vars().update(env.email_url("EMAIL_URL"))
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Rent Tracker <noreply@localhost>")
