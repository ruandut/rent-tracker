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
