# Shortcuts. Each target is a plain command you can also run by hand (see README.md).
VP := $(shell command -v vp 2>/dev/null || echo $(CURDIR)/frontend/node_modules/.bin/vp)
# hatchet-lite's built-in default tenant.
HATCHET_TENANT := 707d0855-80ab-4e1f-a156-f1c4546cbf52

.PHONY: up down setup hatchet-token migrate seed reseed superuser api worker web test check

up:            ## Start Postgres and Hatchet
	docker compose up -d --wait

down:          ## Stop them (data is kept in volumes)
	docker compose down

setup: up      ## First-time setup: deps, env, migrations, Hatchet token, demo data
	cd backend && uv sync
	cd frontend && $(VP) install
	test -f backend/.env || cp backend/.env.example backend/.env
	$(MAKE) migrate hatchet-token seed

hatchet-token: ## Create a Hatchet API token and write it into backend/.env
	@TOKEN=$$(docker compose exec -T hatchet /hatchet-admin token create --config /config --tenant-id $(HATCHET_TENANT) | tail -1); \
	sed -i.bak "s|^HATCHET_CLIENT_TOKEN=.*|HATCHET_CLIENT_TOKEN=$$TOKEN|" backend/.env && rm backend/.env.bak; \
	echo "HATCHET_CLIENT_TOKEN written to backend/.env"

migrate:
	cd backend && uv run python manage.py migrate

seed:          ## Demo user (admin / admin) + a year of sample data. Safe to re-run.
	cd backend && uv run python manage.py seed

reseed:        ## Wipe all ledger/utility data, then seed again
	cd backend && uv run python manage.py seed --reset

superuser:
	cd backend && uv run python manage.py createsuperuser

api:           ## Django on :8001
	cd backend && uv run python manage.py runserver 8001

worker:        ## Hatchet worker (restart it after changing task code)
	cd backend && uv run python manage.py hatchet_worker

web:           ## Vite+ dev server on :5174
	cd frontend && $(VP) dev

test:
	cd backend && uv run pytest -q

check:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && $(VP) check
