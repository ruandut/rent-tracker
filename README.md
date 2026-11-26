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

Log in with the seeded demo account **admin / admin**. Its data is in the **Demo rentals** realm,
or in **My rentals** if your database predates realms.

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

Works on any x86-64 machine with a Docker app or Docker Compose, such as a UGREEN NAS. You generate
one Compose file, then copy it to the server, which pulls the published app image and needs
nothing else. Only the web app is reachable from the network; Django serves the API and the built
frontend.

Every push to `main` makes GitHub Actions build the image and publish it as
`ghcr.io/<owner>/<repo>:latest`. In a fork, run the action once, then set the package to public
under your GitHub profile's **Packages → Package settings**, so servers can pull it without a
login.

### First deploy

1. Generate your Compose file:

   ```bash
   make compose
   ```

   It asks for your server's IP address or hostname, the port, a username and password for your
   first login, and the GitHub repo whose image to run. Press Enter to accept a default; leave
   the password blank to generate one. The result is `deploy/rent-tracker.compose.yml`.
2. On your server, create a project in the Docker app. On a UGREEN NAS: **Project → Create**, with
   the name `rent-tracker` and the storage path `docker/rent-tracker`.
3. Import `deploy/rent-tracker.compose.yml`, or paste its contents into the editor.
4. Click **Deploy**.
5. Open the address the generator printed and sign in. The password is the `ADMIN_PASSWORD` value
   in the Compose file.

The app starts with one empty realm, **My rentals**, owned by that first login: add your rental
units and payment methods first. Demo data never reaches it, because `seed` only runs with
`DEBUG=true`.

**Inviting people:** on **Realms**, open a realm and choose **Invite**. Each invitation has a link
to copy and send yourself. To have the app email it too, add a mail server to the `web` service's
`environment` in your Compose file, for example
`EMAIL_URL: smtp+tls://user:password@smtp.example.com:587` and
`DEFAULT_FROM_EMAIL: Rent Tracker <you@example.com>`. Without them, nothing is emailed.

To change the address or port later, run `make compose` again and replace the project's Compose
file with the result. It keeps the existing secrets, so the database stays reachable. Keep that
file: the database only accepts the password it was created with, and Docker keeps the database
volume even when you delete the containers. If you delete the file, a new one gets new secrets
and the app fails with `password authentication failed` until the volumes are removed.

### Secrets

Your secrets live in the generated file and in the project on your server. That file is gitignored
and must never be committed; only `deploy/compose.template.yml`, which holds placeholders, belongs
in the repo. Keep a copy somewhere safe.

### Updating

Merge to `main` and wait for the **Publish image** action to finish. Then update the project in
the Docker app, or run `docker compose pull` and `docker compose up -d`. Data lives in the
`postgres_data` Docker volume and survives updates.

When the template changes, run `make compose` again with the same answers and paste the new file
into the Docker app. It keeps your existing secrets and only generates ones that are missing.

### Troubleshooting

- **`password authentication failed for user "rent"`:** the Compose file's secrets don't match the
  existing database volume, usually because the file was regenerated from scratch. Recreating
  containers won't help, because the volume survives. Restore the original file, or remove the
  `rent-tracker-*` volumes if there's no data to keep.
- **The server can't pull the image (`denied` or `unauthorized`):** the package isn't public yet,
  or the **Publish image** action hasn't finished.

### Network and backups

The app speaks plain HTTP. To reach it from the internet, put a reverse proxy or tunnel that
serves HTTPS in front of it, such as a Cloudflare Tunnel, rather than forwarding port 8010 on
your router. `make compose` asks for:

- **the public https hostname**, e.g. `app.example.com`. The app then answers both there and on
  the LAN address and port over http;
- **how many proxies are in front** (`1` for Cloudflare), so rate limits see each visitor's
  address instead of the proxy's. With a public hostname, `HTTPS` is on too: cookies become
  https-only and browsers are told to stick to https;
- **the Docker network the tunnel container is on**, when the tunnel runs on the same server
  (e.g. `cloudflared`'s). `web` joins it, so the tunnel can reach `http://rent-tracker-web-1:8000`.
  Find it in the Docker app under the tunnel container's network settings.

Rerun `make compose` to change these rather than editing the generated file: it keeps them, and
anything edited by hand is lost the next time the file is regenerated. With `HTTPS` on, the
Django admin only works over https, because its cookies are https-only.

The app's own protection, which applies either way:

- **Captcha:** login, joining from an invitation and the Django admin's login need an
  [ALTCHA](https://altcha.org) proof of work, served by Django itself.
  A challenge can't be redeemed until 3 seconds after it was issued and works once. The key that
  signs challenges is `ALTCHA_HMAC_KEY`; `CAPTCHA_ENABLED: "false"` switches checking off.
- **Rate limits:** every API request is limited per account once signed in, and per IP before
  that; sign-in routes have a strict per-IP limit. The counters live in
  a Postgres table, as there's no Redis. Tune them with `THROTTLE_ANON`, `THROTTLE_USER`,
  `THROTTLE_AUTH` and `THROTTLE_CAPTCHA` (e.g. `10/min`).
- **Headers:** a Content Security Policy that only runs this site's own scripts,
  `X-Frame-Options: DENY`, `nosniff`, a same-origin referrer policy and a Permissions-Policy that
  turns off camera, microphone, location and the like.

All three come from [django-foundation](https://github.com/ruandut/django-foundation), the shared package for the
captcha, rate limits, headers and the Hatchet worker; `config/settings.py` switches them on.

### Backups

Database backups live in the Django admin (`/admin/`, **Database backups**), which only
superusers see: the first login the Compose file creates is one. A dump holds every realm.

- **Schedules:** add one with a cron expression in UTC (`0 0 * * *` runs at 02:00 in South
  Africa) and how many backups to keep. The worker runs them through Hatchet and deletes the
  oldest beyond that. **Back up now** above the Backups list takes one straight away.
- **Where they go:** the `rent-tracker-backups` Docker volume, on the same disk as the
  database. Copy it somewhere else as well, or add `AWS_S3_BACKUP_BUCKET` (plus
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and, for an S3-compatible service,
  `AWS_S3_ENDPOINT_URL`) to the Compose file's shared environment and choose Amazon S3 on a
  schedule.
- **Rolling back:** choose a backup and the action **Roll the database back to this backup**.
  It takes a fresh backup first, so it can be undone, and restores in one transaction. Meanwhile
  everyone sees a maintenance page, which comes back by itself, signed in, when it's done. Only a
  backup made since the last migration can be restored.

The backups come from [django-foundation](https://github.com/ruandut/django-foundation)'s
`foundation.backups`. Locally they need `pg_dump` 18 or newer: `brew install libpq` and set
`PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump` in `backend/.env`. They land in `backend/media/`.

## What's where

| Screen | Route | Backend |
|---|---|---|
| Dashboard: balance, in/out this month, monthly bars, spend by tag | `/` | `GET /api/dashboard/` |
| Expense tracking: log income, expenses and transfers, beneficiary, tags | `/transactions` | `/api/transactions/` |
| Water & electricity per unit per month | `/utilities` | `/api/readings/` |
| Rates & taxes and other municipal charges | `/charges` | `/api/charges/` |
| Rental units | `/units` | `/api/units/` |
| Payment methods (cards/accounts) | `/payment-methods` | `/api/payment-methods/` |
| Beneficiaries | `/beneficiaries` | `/api/beneficiaries/` |
| Tags (`maintenance` is a system tag: renameable, not deletable) | `/tags` | `/api/tags/` |
| Scheduled summaries by email or Telegram | `/summaries` | `/api/notifications/` |
| Municipal bills, line by line, with the raw bill | `/bills` | `/api/bills/` |
| Realms: create, switch, members, invitations, leave, delete | `/realms` | `/api/realms/` |
| Joining from an invitation link (there's no open sign-up) | `/register?invite=…` | `/api/auth/register/` |

- **Realms:** multi-tenancy. A realm is one set of books, and every row in the domain apps belongs
  to one (`TenantModel` in `apps/realms/models.py`). People join as an admin or a member; only
  admins invite, change roles, change delivery settings, rename or delete the realm. Each browser
  tab sends its realm as the `X-Realm` header, so two tabs can be in different realms; without it
  the user's last-chosen realm is used. `InRealm` is a default DRF permission, so every endpoint
  is realm-gated unless it opts out, and `RealmScopedViewSet` and `RealmScopedSerializer`
  (`apps/realms/access.py`) keep lookups, new rows and foreign keys inside the realm. A new realm
  gets the maintenance tag and the George template through the `realm_created` signal.
- **Filters:** the date range + rental unit show on the screens that use them, via `<Page filters>`,
  and carry between those screens. They live in a
  persisted Zustand store (`frontend/src/stores/filters.ts`) and go to the API as
  `?date_from=&date_to=&unit=` (`backend/apps/core/filters.py`).
- **Balances:** a payment method's balance is its opening balance plus all-time income and transfers
  in, minus expenses and transfers out, so it ignores the filters; the in/out and moved figures
  beside it respect them.
- **Transfers** move money between your own accounts, such as rent into savings. They change both
  balances but aren't income or expenses, so they stay out of every in/out total. Accounts of the
  Savings type get their own dashboard figure. Interest is ordinary income on the savings account.
- **Utility readings and charges** record what was billed. Paying the bill is still a
  transaction; a charge can point at the transaction that paid it.
- **Municipal bills** are the source of truth for what they cover. One printed bill is split
  between any number of rental units, each with its own lines. A template (Municipal templates
  screen) defines a municipality's fields and services; a bill copies its template when logged, so
  later template edits leave it alone. Saving one creates or updates
  its rows in Water & electricity and Rates & taxes (at VAT-inclusive cost), and
  those rows can only be changed on the bill. `apps.bills` knows nothing about `apps.utilities`:
  it sends the `bill_saved` signal and `apps/utilities/services.py` does the syncing. Uploaded
  files are stored in Postgres, so they need no media volume and stay behind the login.
- **Hatchet:** apps expose tasks via `TASKS = [...]` in `apps/<app>/tasks.py`; `make worker` registers
  them. `send-due-summaries` runs every minute and sends any summary that's due. `ledger-ping` is
  a placeholder where email ingestion will go (`Transaction.source = "email"` is already reserved).
- **Summaries:** each realm has its own mail server, Telegram bot and schedules. Set up email or
  Telegram on the Summaries screen, then schedule a balance and
  totals summary. **Send now** tests delivery straight away. Scheduled sends need the worker
  running, and if it was down they send once rather than catching up. Passwords and bot tokens are
  encrypted using `DJANGO_SECRET_KEY`. Telegram bots can't message phone numbers, so they need a
  chat ID from someone who has pressed Start on the bot.
