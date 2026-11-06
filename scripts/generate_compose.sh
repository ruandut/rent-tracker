#!/usr/bin/env bash
# Asks for your server's details and writes deploy/rent-tracker.compose.yml, with freshly generated
# secrets, ready to copy into your Docker app. The output is gitignored; it must stay that way.
# Anything passed as a flag isn't asked for:
#   ./scripts/generate_compose.sh [--host 192.168.1.20] [--port 8010] [--username admin]
#                                 [--password secret] [--repo owner/name]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deploy/rent-tracker.compose.yml"
HOST="" PORT="" USERNAME="" PASSWORD="" REPO=""
PASSWORD_SET=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --username) USERNAME="$2"; shift ;;
    --password) PASSWORD="$2"; PASSWORD_SET=true; shift ;;
    --repo) REPO="$2"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

# Running this again keeps the existing secrets: the database only accepts the password it was
# created with, so new ones would lock the app out of an existing install.
existing() { [[ -f "$OUT" ]] && sed -nE "s/^ *$1: \"([^\"]+)\"$/\1/p" "$OUT" | head -1 || true; }
POSTGRES_PASSWORD="$(existing POSTGRES_PASSWORD)"
DJANGO_SECRET_KEY="$(existing DJANGO_SECRET_KEY)"
EXISTING_PASSWORD="$(existing ADMIN_PASSWORD)"
if [[ -n "$POSTGRES_PASSWORD" ]]; then
  echo "Updating your existing Compose file; its secrets stay the same."
fi

ask() { # ask <prompt> <default>: prints the answer, or the default on Enter.
  local answer
  read -r -p "$1${2:+ [$2]}: " answer || true
  printf '%s' "${answer:-$2}"
}

# The repo this checkout came from, so a fork runs its own image.
DEFAULT_REPO="$(git -C "$ROOT" remote get-url origin 2>/dev/null \
  | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##' || true)"
[[ "$DEFAULT_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || DEFAULT_REPO=ruandut/rent-tracker

[[ -n "$HOST" ]] || HOST="$(ask "Server IP address or hostname" "")"
[[ -n "$PORT" ]] || PORT="$(ask "Port to run on" 8010)"
[[ -n "$USERNAME" ]] || USERNAME="$(ask "First login username" admin)"
if [[ "$PASSWORD_SET" != true ]]; then
  read -r -s -p "First login password (Enter to generate one): " PASSWORD || true
  echo
fi
[[ -n "$REPO" ]] || REPO="$(ask "GitHub repo whose image to run" "$DEFAULT_REPO")"

fail() { echo "$1" >&2; exit 1; }

# These all end up unescaped in a URL or YAML file, so keep them to safe characters.
[[ "$HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
  || fail "Enter an IP address or hostname only, without http:// or a port."
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) || fail "Port must be 1 to 65535."
[[ "$USERNAME" =~ ^[A-Za-z0-9_.-]+$ ]] \
  || fail "Username can only use letters, numbers and . _ -"
[[ -z "$PASSWORD" || "$PASSWORD" =~ ^[A-Za-z0-9_.-]{12,}$ ]] \
  || fail "Password needs 12+ characters: letters, numbers and . _ - only."
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "Repo must look like owner/name."

PASSWORD="${PASSWORD:-${EXISTING_PASSWORD:-$(openssl rand -hex 12)}}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 24)}"
DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-$(openssl rand -hex 32)}"

umask 077
sed \
  -e "s|__HOST__|$HOST|g" \
  -e "s|__PORT__|$PORT|g" \
  -e "s|__IMAGE__|$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')|g" \
  -e "s|__ADMIN_USERNAME__|$USERNAME|g" \
  -e "s|__ADMIN_PASSWORD__|$PASSWORD|g" \
  -e "s|__DJANGO_SECRET_KEY__|$DJANGO_SECRET_KEY|g" \
  -e "s|__POSTGRES_PASSWORD__|$POSTGRES_PASSWORD|g" \
  "$ROOT/deploy/compose.template.yml" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

cat <<DONE

Your Compose file is ready: deploy/rent-tracker.compose.yml
Copy it into your server's Docker app and deploy it. Then open http://$HOST:$PORT
and sign in as $USERNAME (the password is ADMIN_PASSWORD in that file).
DONE
