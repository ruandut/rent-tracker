# Rent Tracker

Tracks money in and out of a rental bank account, plus utilities and municipal charges per unit.
The [README](README.md) covers the stack, setup, commands and deployment; read it first. These are
the rules that aren't obvious from the code.

## Git, CI, releases and deployment

The flow: work on `dev` → pull request `dev` → `main` → CI on the PR → merge → CI on `main` → the
image is published → if `backend/pyproject.toml`'s version is new, that's a release, and the NAS
can update to it. `main` is always green. The README's "Releases and CI", "Updating" and "Rolling
back" sections are the user-facing version of this.

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and on every push to `main`, as
  two jobs side by side: `lint` (ruff check and format, installing only the `lint` dependency
  group; the frontend's `vp build` and `vp check`; `docker buildx build --check .`) and `test`
  (pytest against a Postgres 18 service, with throwaway secrets). A newer push to the same ref
  cancels the older run.
- **Publish image** (`.github/workflows/publish-image.yml`) runs when CI finishes on a push to
  `main`, and only if it passed. It builds that commit once and pushes `main` and
  `sha-<commit>`. If `v<version>` isn't a tag yet, the same run is a release: it adds `X.Y.Z`,
  `X.Y`, `X` and `latest`, then tags the commit and publishes a GitHub Release with notes from
  the merged PRs. Pre-releases (`a`/`b`/`rc`/`.dev`) get only their own tag, never `latest`.
  "Run workflow" on `main` rebuilds by hand.
- **The NAS runs `latest`**, so only releases reach it. The app shows its version and commit at
  the bottom of the user menu (`/api/auth/me/`'s `app`; the public healthcheck doesn't say).
- **Releasing** is bumping `version` in `backend/pyproject.toml` (and `uv lock`) in a PR. Bump
  only when Ruan asks; never tag by hand, and never move or delete a published tag or image
  version: rolling back pins them. Patch for fixes; minor for features, migrations or new
  Compose contents (say which in the PR, so the notes carry it); major for breaking changes.
- **Rolling back** is pinning the Compose file's image to an earlier version (`:0.1.0`) and
  redeploying, then going back to `latest` once a fix is released. Across a migration that isn't
  safe, and the admin only restores backups made since the last migration, so fix forward with a
  patch release instead.
- **Rulesets on GitHub** (not in the repo; Settings → Rules) should match django-foundation's:
  "Protect main" requires a pull request, the `lint` and `test` checks and the branch up to date,
  and blocks force pushes and deletion; "Protect release tags" stops `v*` tags being moved or
  deleted. The job names `lint` and `test` are those checks: rename or add a required job only
  together with the ruleset, or every PR waits forever.
- Work on `dev`. Never commit, merge or push to `main` unless Ruan asks; open a pull request from
  `dev` instead, and never merge it or turn on auto-merge unless Ruan asks.
- Never build the production image on the Mac. CI lints it; Publish image builds it.
- The NAS is managed through the UGOS Docker app, so its Compose file gets pasted in by hand. Any
  change that needs new Compose contents must say so, because a push alone won't apply it. When
  a release needs the new contents (a new required setting), paste them before updating.

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
- `web` talks to Hatchet as well as `worker`: the Django admin creates backup schedules' crons
  and queues "Back up now". Both read the token from the `hatchet_token` volume at start, and
  both need `HATCHET_CLIENT_SERVER_URL`, since the token names Hatchet's API as `localhost:8888`.
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
