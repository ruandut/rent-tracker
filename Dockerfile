# Production image: builds the SPA, then Django serves it alongside the API.
# SRC is the source folder inside the build context: GitHub archives wrap the repo in one.
FROM node:22-bookworm-slim AS frontend
ARG SRC=.
WORKDIR /frontend
RUN npm install -g pnpm@12.15.0
COPY ${SRC}/frontend/ ./
RUN pnpm install --frozen-lockfile && pnpm exec vp build

FROM python:3.14-slim
ARG SRC=.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH
RUN pip install --no-cache-dir uv
WORKDIR /app/backend
COPY ${SRC}/backend/pyproject.toml ${SRC}/backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY ${SRC}/backend/ ./
COPY --from=frontend /frontend/dist ./spa
# Throwaway values: collectstatic only needs settings to load.
RUN DJANGO_SECRET_KEY=build DATABASE_URL=sqlite:// python manage.py collectstatic --noinput
