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
RUN pip install --no-cache-dir uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ ./
COPY --from=frontend /frontend/dist ./spa
# Throwaway values: collectstatic only needs settings to load.
RUN DJANGO_SECRET_KEY=build DATABASE_URL=sqlite:// python manage.py collectstatic --noinput
