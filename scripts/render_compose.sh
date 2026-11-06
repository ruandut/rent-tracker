#!/usr/bin/env bash
# Writes deploy/rent-tracker.compose.yml with freshly generated secrets, ready to paste into
# the UGOS Docker app. The output is gitignored; keep it safe, it holds the database password.
# Usage: ./scripts/render_compose.sh --host 192.168.0.78 [--port 8010] [--username ruan] [--tag 1]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deploy/rent-tracker.compose.yml"
HOST=""
PORT=8010
USERNAME=ruan
TAG=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --username) USERNAME="$2"; shift ;;
    --tag) TAG="$2"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ -z "$HOST" ]]; then
  echo "--host is required: the address browsers use to reach the server." >&2
  exit 1
fi
# Never overwrite: new secrets would no longer match the existing database.
if [[ -f "$OUT" ]]; then
  echo "$OUT already exists; refusing to overwrite it." >&2
  exit 1
fi

ADMIN_PASSWORD="$(openssl rand -hex 12)"

umask 077
sed \
  -e "s/__HOST__/$HOST/g" \
  -e "s/__PORT__/$PORT/g" \
  -e "s/__TAG__/$TAG/g" \
  -e "s/__ADMIN_USERNAME__/$USERNAME/g" \
  -e "s/__ADMIN_PASSWORD__/$ADMIN_PASSWORD/g" \
  -e "s/__DJANGO_SECRET_KEY__/$(openssl rand -hex 32)/g" \
  -e "s/__POSTGRES_PASSWORD__/$(openssl rand -hex 24)/g" \
  "$ROOT/deploy/compose.template.yml" > "$OUT"

echo "Wrote $OUT"
echo "Sign in at http://$HOST:$PORT as $USERNAME (password is ADMIN_PASSWORD in that file)."
