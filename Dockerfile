# Production image: builds the SPA, then Django serves it alongside the API.
FROM node:22-bookworm-slim AS frontend
WORKDIR /frontend
RUN npm install -g pnpm@12.15.0
COPY frontend/ ./
RUN pnpm install --frozen-lockfile && pnpm exec vp build

FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH
# pg_dump and pg_restore for database backups (django-foundation's backups app). From the
# PostgreSQL project's own apt repository, so they match the postgres:18 server in Compose:
# Debian's own are older, and pg_dump refuses a newer server.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ ./
COPY --from=frontend /frontend/dist ./spa
# Throwaway values: collectstatic only needs settings to load. None of them reach the image's
# environment; Compose provides the real ones.
RUN DJANGO_SECRET_KEY=build DATABASE_URL=sqlite:// \
    MFA_ENCRYPTION_KEY=YnVpbGQtb25seS10aHJvd2F3YXkta2V5LW5vLXVzZSE= \
    python manage.py collectstatic --noinput
