# Rent Tracker

Tracks money in and out of a rental bank account, plus utilities and municipal charges per unit.
The [README](README.md) covers the stack, setup, commands and deployment; read it first. These are
the rules that aren't obvious from the code.

## Branches and deployment

- Work on `dev`. Never commit, merge or push to `main` unless Ruan asks.
- `main` is production. Each push publishes `ghcr.io/ruandut/rent-tracker:latest` through
  `.github/workflows/publish-image.yml`, and the NAS runs that image.
- Never build the production image on the Mac. Check it with `docker buildx build --check .`, which
  lints without building, and let GitHub Actions do the real build.
- The NAS is managed through the UGOS Docker app, so its Compose file gets pasted in by hand. Any
  change that needs new Compose contents must say so, because a push alone won't apply it.

## Secrets

- `deploy/rent-tracker.compose.yml` holds real secrets. It's gitignored and must never be
  committed, printed or read into a conversation. Only `deploy/compose.template.yml` belongs in git.
- Change deployment settings in the template, then rerun `scripts/generate_compose.sh`, which keeps
  the existing secrets. Compare a hash of them before and after rather than displaying them.
- Postgres keeps the password it was created with, and Docker volumes outlive containers. A file
  with new secrets locks the app out of an existing database.
- Before committing, check that no secret values are in the staged diff.

## Production Compose

- Don't add one-shot containers. UGOS flags a project as Error when any container has stopped, so
  setup steps run in the background inside `postgres` and `hatchet`.
- Make startup order explicit: healthchecks prove that a dependency is really usable, and
  `depends_on` waits for them. Postgres readiness must be checked over TCP, because it answers on
  its socket during first-time setup, before other containers can connect.
- Keep volume names fixed, so they don't depend on what the Docker app calls the project.
- A real address only belongs in generated output. The repo must stay deployable by anyone.

## Backend

- List endpoints filter through `apps/core/filters.py`, the shared date range and rental unit.
- Django drops `Meta.ordering` from aggregated queries, so annotated querysets need `order_by`.
- Use non-capturing groups in `re_path`: captured groups become view arguments.
- Hatchet tasks live in `apps/<app>/tasks.py` under `TASKS = [...]`. They run outside Django's
  request cycle, so call `close_old_connections()` around ORM work.
- Encrypt stored credentials with `apps/notifications/crypto.py` and never return them from the API.

## Frontend

- TanStack Query owns server data, Zustand owns tokens and the shared filters, and TanStack Router
  owns the URL. Routes use one folder per screen under `src/routes/_app/`.
- Build for phone width too, using `useIsMobile()` when the layout has to change. Pages must not
  scroll sideways.
- Table rows stay one consistent height. Give the main text column `flexCell` from
  `components/page.tsx`, and keep each line to a single ellipsized line.
- Colours must work in both light and dark mode.

## Checking work

- `make test` needs the dev Postgres from `make up`. `make check` runs lint, formatting and types.
- Test a route through the resolver and middleware, not just its regex and view separately.
- Run new Hatchet behaviour against a real local worker. For Compose changes, run the `postgres`
  and `hatchet` services on a throwaway project, covering a fresh install and an upgrade.
- Say plainly what wasn't tested. The `web` and `worker` containers only run for real after a
  publish, and live Telegram delivery has never been confirmed from here.
- Don't report deployment logs' causes as fact when they're inferred; say what the logs prove.
