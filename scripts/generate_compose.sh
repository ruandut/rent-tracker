#!/usr/bin/env bash
# Asks for your server's details and writes deploy/rent-tracker.compose.yml, with freshly generated
# secrets, ready to copy into your Docker app. The output is gitignored; it must stay that way.
# Anything passed as a flag isn't asked for:
#   ./scripts/generate_compose.sh [--host 192.168.1.20] [--port 8010] [--username admin]
#                                 [--password secret] [--repo owner/name]
#                                 [--public-host app.example.com] [--num-proxies 1]
#                                 [--tunnel-network cloudflared_default]
# --public-host is the hostname the internet reaches over https, through a proxy or tunnel such
# as Cloudflare; "none" removes it. The app stays reachable on --host and --port over http.
# --tunnel-network is the Docker network a tunnel container (cloudflared) is on, which `web`
# then joins so the tunnel can reach http://rent-tracker-web-1:8000; "none" for no tunnel.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deploy/rent-tracker.compose.yml"
HOST="" PORT="" USERNAME="" PASSWORD="" REPO="" PUBLIC_HOST="" NUM_PROXIES="" TUNNEL_NETWORK=""
PASSWORD_SET=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --username) USERNAME="$2"; shift ;;
    --password) PASSWORD="$2"; PASSWORD_SET=true; shift ;;
    --repo) REPO="$2"; shift ;;
    --public-host) PUBLIC_HOST="$2"; shift ;;
    --num-proxies) NUM_PROXIES="$2"; shift ;;
    --tunnel-network) TUNNEL_NETWORK="$2"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

# Running this again keeps the existing secrets: the database only accepts the password it was
# created with, so new ones would lock the app out of an existing install.
existing() { [[ -f "$OUT" ]] && sed -nE "s/^ *$1: \"([^\"]+)\"$/\1/p" "$OUT" | head -1 || true; }
POSTGRES_PASSWORD="$(existing POSTGRES_PASSWORD)"
DJANGO_SECRET_KEY="$(existing DJANGO_SECRET_KEY)"
ALTCHA_HMAC_KEY="$(existing ALTCHA_HMAC_KEY)"
MFA_ENCRYPTION_KEY="$(existing MFA_ENCRYPTION_KEY)"
EXISTING_PASSWORD="$(existing ADMIN_PASSWORD)"
# The earlier answers become the defaults, so a rerun only needs Enter (or no terminal at all).
grab() { [[ -f "$OUT" ]] && sed -nE "$1" "$OUT" | head -1 || true; }
# ALLOWED_HOSTS is "<host>,<public host>,localhost", or "<host>,localhost" without a public one.
OLD_HOSTS="$(grab 's/^ *ALLOWED_HOSTS: *"?([^"]*)"?$/\1/p')"
OLD_HOST="${OLD_HOSTS%%,*}"
OLD_PUBLIC_HOST="$(printf '%s' "$OLD_HOSTS" | tr ',' '\n' | sed -n '2p' | grep -vx localhost || true)"
OLD_NUM_PROXIES="$(existing NUM_PROXIES)"
OLD_TUNNEL_NETWORK="$(grab 's/^ *name: ([^ ]+)  # tunnel-only$/\1/p')"
OLD_PORT="$(grab 's/^ *- "([0-9]+):8000"$/\1/p')"
OLD_USERNAME="$(existing ADMIN_USERNAME)"
OLD_REPO="$(grab 's/^ *image: ghcr\.io\/([^:]+):latest$/\1/p')"
UPDATING=false
if [[ -n "$POSTGRES_PASSWORD" ]]; then
  UPDATING=true
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

[[ -n "$HOST" ]] || HOST="$(ask "Server IP address or hostname" "$OLD_HOST")"
[[ -n "$PORT" ]] || PORT="$(ask "Port to run on" "${OLD_PORT:-8010}")"
[[ -n "$USERNAME" ]] || USERNAME="$(ask "First login username" "${OLD_USERNAME:-admin}")"
if [[ "$PASSWORD_SET" != true ]]; then
  prompt="First login password (Enter to generate one): "
  [[ -n "$EXISTING_PASSWORD" ]] && prompt="First login password (Enter to keep the current one): "
  read -r -s -p "$prompt" PASSWORD || true
  echo
fi
[[ -n "$REPO" ]] || REPO="$(ask "GitHub repo whose image to run" "${OLD_REPO:-$DEFAULT_REPO}")"
[[ -n "$PUBLIC_HOST" ]] || PUBLIC_HOST="$(ask \
  "Public https hostname, through a proxy or tunnel (\"none\" for LAN only)" \
  "${OLD_PUBLIC_HOST:-none}")"
[[ "$PUBLIC_HOST" == none ]] && PUBLIC_HOST=""
if [[ -n "$PUBLIC_HOST" && -z "$NUM_PROXIES" ]]; then
  # Cloudflare, or one reverse proxy, in front: 1. Each proxy adds one to X-Forwarded-For.
  NUM_PROXIES="$(ask "Proxies in front of the app, e.g. 1 for Cloudflare" \
    "$( [[ "${OLD_NUM_PROXIES:-0}" != 0 ]] && echo "$OLD_NUM_PROXIES" || echo 1 )")"
fi
NUM_PROXIES="${NUM_PROXIES:-0}"
[[ -n "$PUBLIC_HOST" ]] || NUM_PROXIES=0
if [[ -n "$PUBLIC_HOST" && -z "$TUNNEL_NETWORK" ]]; then
  TUNNEL_NETWORK="$(ask \
    "Docker network your tunnel container (cloudflared) is on (\"none\" if it reaches the app by IP)" \
    "${OLD_TUNNEL_NETWORK:-none}")"
fi
[[ -z "$PUBLIC_HOST" || "$TUNNEL_NETWORK" == none ]] && TUNNEL_NETWORK=""

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
[[ -z "$PUBLIC_HOST" || "$PUBLIC_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
  || fail "Enter the public hostname only, without https:// or a path."
[[ "$NUM_PROXIES" =~ ^[0-9]$ ]] || fail "Proxies must be a number from 0 to 9."
[[ -z "$TUNNEL_NETWORK" || "$TUNNEL_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] \
  || fail "A Docker network name uses letters, numbers and . _ - only."

# Both addresses work: http on the LAN, and https on the public hostname, where HTTPS turns on
# secure cookies and HSTS.
ALLOWED_HOSTS="$HOST,localhost"
CSRF_TRUSTED_ORIGINS="http://$HOST:$PORT"
HTTPS=false
if [[ -n "$PUBLIC_HOST" ]]; then
  ALLOWED_HOSTS="$HOST,$PUBLIC_HOST,localhost"
  CSRF_TRUSTED_ORIGINS="$CSRF_TRUSTED_ORIGINS,https://$PUBLIC_HOST"
  HTTPS=true
fi

PASSWORD="${PASSWORD:-${EXISTING_PASSWORD:-$(openssl rand -hex 12)}}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 24)}"
DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-$(openssl rand -hex 32)}"
# Files from before the captcha or two-factor sign-in have none yet; adding one doesn't touch the
# other secrets.
if [[ -z "$ALTCHA_HMAC_KEY" ]]; then
  ALTCHA_HMAC_KEY="$(openssl rand -hex 32)"
  [[ "$UPDATING" == true ]] && echo "Added a new secret: ALTCHA_HMAC_KEY."
fi
if [[ -z "$MFA_ENCRYPTION_KEY" ]]; then
  # A Fernet key: 32 random bytes in URL-safe base64.
  MFA_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr '+/' '-_')"
  [[ "$UPDATING" == true ]] && echo "Added a new secret: MFA_ENCRYPTION_KEY."
fi

umask 077
sed \
  -e "s|__ALLOWED_HOSTS__|$ALLOWED_HOSTS|g" \
  -e "s|__CSRF_TRUSTED_ORIGINS__|$CSRF_TRUSTED_ORIGINS|g" \
  -e "s|__NUM_PROXIES__|$NUM_PROXIES|g" \
  -e "s|__HTTPS__|$HTTPS|g" \
  -e "s|__HOST__|$HOST|g" \
  -e "s|__PORT__|$PORT|g" \
  -e "s|__IMAGE__|$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')|g" \
  -e "s|__ADMIN_USERNAME__|$USERNAME|g" \
  -e "s|__ADMIN_PASSWORD__|$PASSWORD|g" \
  -e "s|__DJANGO_SECRET_KEY__|$DJANGO_SECRET_KEY|g" \
  -e "s|__POSTGRES_PASSWORD__|$POSTGRES_PASSWORD|g" \
  -e "s|__ALTCHA_HMAC_KEY__|$ALTCHA_HMAC_KEY|g" \
  -e "s|__MFA_ENCRYPTION_KEY__|$MFA_ENCRYPTION_KEY|g" \
  -e "s|__TUNNEL_NETWORK__|$TUNNEL_NETWORK|g" \
  "$ROOT/deploy/compose.template.yml" \
  | if [[ -n "$TUNNEL_NETWORK" ]]; then cat; else sed '/# tunnel-only$/d'; fi > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

cat <<DONE

Your Compose file is ready: deploy/rent-tracker.compose.yml
Copy it into your server's Docker app and deploy it. Then open http://$HOST:$PORT${PUBLIC_HOST:+
or https://$PUBLIC_HOST} and sign in as $USERNAME (the password is ADMIN_PASSWORD in that file).
DONE
