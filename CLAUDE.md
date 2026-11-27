# Rent Tracker

Tracks money in and out of a rental bank account, plus utilities and municipal charges per unit.
The [README](README.md) covers the stack, setup, commands and deployment; read it first. These are
the rules that aren't obvious from the code.

## Git, CI and deployment

The flow: work on `dev` → pull request `dev` → `main` → CI on the PR → merge → CI on `main` → the
image is published → the NAS updates to it. `main` is production and always green.

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and on every push to `main`, as
  two jobs side by side: `lint` (ruff check and format, installing only the `lint` dependency
  group; the frontend's `vp build` and `vp check`; `docker buildx build --check .`) and `test`
  (pytest against a Postgres 18 service, with throwaway secrets). A newer push to the same ref
  cancels the older run.
- **Publish** (`.github/workflows/publish-image.yml`) runs when CI finishes on a push to `main`,
  and only if it passed. It builds the image from that commit and pushes
  `ghcr.io/ruandut/rent-tracker:latest` and `:<sha>`; the NAS runs `latest`. "Run workflow" on
  `main` republishes by hand.
- **Rulesets on GitHub** (not in the repo; Settings → Rules) should match django-foundation's:
  "Protect main" requires a pull request, the `lint` and `test` checks and the branch up to date,
  and blocks force pushes and deletion. The job names `lint` and `test` are those checks: rename
  or add a required job only together with the ruleset, or every PR waits forever.
- Work on `dev`. Never commit, merge or push to `main` unless Ruan asks; open a pull request from
  `dev` instead, and never merge it or turn on auto-merge unless Ruan asks.
- Never build the production image on the Mac. CI lints it; Publish builds it.
- The NAS is managed through the UGOS Docker app, so its Compose file gets pasted in by hand. Any
  change that needs new Compose contents must say so, because a push alone won't apply it. When
  the new image needs the new contents (a new required setting), paste them before merging.

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

- The captcha, rate limits, security headers, Postgres cache and Hatchet worker come from the
  shared `django-foundation` package (`../django-foundation`), switched on in `config/settings.py`.
  Change that code in the package, so every app built on it gets the fix.
- Everything is multi-tenant. New domain models subclass `TenantModel` (`apps/realms/models.py`);
  viewsets extend `RealmScopedViewSet` and serializers `RealmScopedSerializer`
  (`apps/realms/access.py`). Names unique per realm go in `realm_unique`, never `unique=True`.
  Function views filter by `request.realm` themselves. Endpoints that work across realms opt out
  of the default `InRealm` permission, and Hatchet tasks span every realm.
- Every endpoint gets a realm-isolation test in `apps/realms/test_isolation.py`: another realm's
  rows stay out of lists, detail routes 404, and foreign keys can't point into it.
- List endpoints filter through `apps/core/filters.py`, the shared date range and rental unit.
- Django drops `Meta.ordering` from aggregated queries, so annotated querysets need `order_by`.
- Use non-capturing groups in `re_path`: captured groups become view arguments.
- Hatchet tasks live in `apps/<app>/tasks.py` under `TASKS = [...]`. They run outside Django's
  request cycle, so call `close_old_connections()` around ORM work.
- Encrypt stored credentials with `apps/notifications/crypto.py` and never return them from the API.
- Two-factor sign-in is django-foundation's `foundation.mfa`, under `/api/auth/mfa/`. It belongs to
  the account, so `apps/accounts/urls.py` swaps its default `InRealm` for `IsAuthenticated`.
  `MFA_ENCRYPTION_KEY` encrypts its secrets; losing or changing it breaks everyone's app codes.

## Frontend

- TanStack Query owns server data, Zustand owns tokens, the tab's realm and the shared filters, and
  TanStack Router owns the URL. Change realm only through `enterRealm()`, which drops the old
  realm's cached data. Routes use one folder per screen under `src/routes/_app/`.
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
