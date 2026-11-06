# Rent Tracker

Tracks every rand moving in and out of the rental bank account, plus monthly water and
electricity usage and municipal charges (rates & taxes, refuse, levies…) per rental unit.

**React · Vite+ · TanStack Router (file/folder routes) · TanStack Query · Zustand · shadcn/Tailwind** —
**Django 6 · DRF · SimpleJWT** — **Hatchet** — **Postgres**. No Redis.

## Prerequisites

| Tool | Why |
|---|---|
| Docker | Postgres + Hatchet (`docker-compose.yml`) |
| [uv](https://docs.astral.sh/uv/) | Python + backend deps |
| Node 22+ and pnpm | Used under the hood by Vite+ |
| [Vite+](https://viteplus.dev) `vp` *(optional global)* | Frontend toolchain; falls back to `frontend/node_modules/.bin/vp` |

## First run

```bash
make setup     # docker up, uv sync, vp install, .env, migrations, Hatchet token, demo data
```

Then, in separate terminals:

```bash
make api       # Django on http://localhost:8001
make web       # Vite+ on http://localhost:5174  ← open this
make worker    # Hatchet worker (optional for now)
```

Log in with the seeded demo account **admin / admin**.

## Everyday commands

```bash
make seed      # demo data (idempotent)
make reseed    # wipe ledger + utility data and seed again
make test      # backend tests (pytest)
make check     # ruff + vp check (lint, format, types)
make down      # stop Docker (data kept); `docker compose down -v` deletes it
```

Ports are offset from the defaults so this runs next to other projects:
Postgres `5434`, Hatchet dashboard `8890` (login `admin@example.com` / `Admin123!!`), Hatchet gRPC `7079`.

## Deploying to your own server

Works on any machine with a Docker app or Docker Compose, such as a UGREEN NAS. You generate one
Compose file, then copy it to the server. The server builds the image itself from `main` on
GitHub, so it needs internet access and only needs that one file. Only the web app is reachable
from the network; Django serves the API and the built frontend.

### First deploy

1. Generate your Compose file:

   ```bash
   make compose
   ```

   It asks for your server's IP address or hostname, the port, a username and password for your
   first login, and the GitHub repo to build from. Press Enter to accept a default; leave the
   password blank to generate one. The result is `deploy/rent-tracker.compose.yml`.
2. On your server, create a project in the Docker app. On a UGREEN NAS: **Project → Create**, with
   the name `rent-tracker` and the storage path `docker/rent-tracker`.
3. Import `deploy/rent-tracker.compose.yml`, or paste its contents into the editor.
4. Click **Deploy**. The first build takes a few minutes.
5. Open the address the generator printed and sign in. The password is the `ADMIN_PASSWORD` value
   in the Compose file.

The app starts empty: add your rental units and payment methods first. Demo data never reaches
it, because `seed` only runs with `DEBUG=true`.

To change the address or port later, edit `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` and the published
port in the project's Compose file, and redeploy. Don't generate a new file for an existing
install: its new secrets wouldn't match the database, which is why the generator won't overwrite
one.

### Secrets

Your secrets live in the generated file and in the project on your server. That file is gitignored
and must never be committed; only `deploy/compose.template.yml`, which holds placeholders, belongs
in the repo. Keep a copy somewhere safe.

### Updating

Push to `main`, then redeploy the project in the Docker app; it rebuilds from the latest code.
Data lives in the `postgres_data` Docker volume and survives rebuilds.

### Troubleshooting

- **The error mentions `pull_policy`:** the server's Compose is too old for it. Delete the line.
- **The build can't fetch the source:** the repo must be readable without a login, and the server
  needs internet access. It downloads GitHub's source archive because some hosts' Docker has no
  `git`, so a Git URL won't work on them.

### Network and backups

The app uses plain HTTP, so keep it on your home network and don't forward port 8010 on your
router.

**Backups:** the database holds real financial records and nothing backs it up yet.

## What's where

| Screen | Route | Backend |
|---|---|---|
| Dashboard: balance, in/out this month, monthly bars, spend by tag | `/` | `GET /api/dashboard/` |
| Expense tracking: log income/expenses, beneficiary, tags | `/transactions` | `/api/transactions/` |
| Water & electricity per unit per month | `/utilities` | `/api/readings/` |
| Rates & taxes and other municipal charges | `/charges` | `/api/charges/` |
| Rental units | `/units` | `/api/units/` |
| Payment methods (cards/accounts) | `/payment-methods` | `/api/payment-methods/` |
| Beneficiaries | `/beneficiaries` | `/api/beneficiaries/` |
| Tags (`maintenance` is a system tag: renameable, not deletable) | `/tags` | `/api/tags/` |

- **Filters:** the date range + rental unit in the header apply to every screen. They live in a
  persisted Zustand store (`frontend/src/stores/filters.ts`) and go to the API as
  `?date_from=&date_to=&unit=` (`backend/apps/core/filters.py`).
- **Balances:** a payment method's balance is its opening balance plus all-time income minus
  expenses, so it ignores the filters; the in/out figures beside it respect them.
- **Utility readings and charges** record what was billed. Paying the bill is still a
  transaction; a charge can point at the transaction that paid it.
- **Hatchet:** apps expose tasks via `TASKS = [...]` in `apps/<app>/tasks.py`; `make worker` registers
  them. Today there's only `ledger-ping`, a placeholder where email ingestion will go
  (`Transaction.source = "email"` is already reserved).
