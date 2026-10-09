#!/usr/bin/env bash
# Launch backend (uvicorn) and frontend (vite preview, built) servers.
#
# The frontend is built with VITE_API_URL=/api and vite preview proxies /api to
# the backend, so only FRONTEND_PORT needs exposing (container -p, or
# `ssh -L 4173:localhost:4173 host`). The backend listens on 127.0.0.1 only.
#
# Env:
#   BACKEND_PORT (8000)  FRONTEND_PORT (4173)  FRONTEND_HOST (0.0.0.0)
#   BACKEND_HOST (127.0.0.1; set 0.0.0.0 to expose the API directly)
#   SKIP_BUILD=1         reuse an existing client/dist (e.g. built into an image)
#   VITE_ALLOWED_HOSTS   hostnames the frontend may be reached by ("all" for any)
#   SVIDAT_ADMIN_USER + SVIDAT_ADMIN_PASSWORD   create that admin on start if missing
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"
VENV_DIR="$SERVER_DIR/.venv"
export BACKEND_PORT  # read by vite.config.ts for the /api proxy target

PIDS=()

cleanup() {
  echo
  echo "Shutting down..."
  if [ "${#PIDS[@]}" -gt 0 ]; then
    for pid in "${PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ ! -x "$VENV_DIR/bin/uvicorn" ]; then
  echo "Backend venv not found at $VENV_DIR. Run 'python3 install.py' first." >&2
  exit 1
fi

# --- secret key ---
# Without one the backend signs JWTs with a public default. If neither the env
# nor server/.env sets it, generate one and keep it in the data dir so it
# survives container restarts (the data dir is the persisted volume).
if [ -z "${SECRET_KEY:-}" ] && ! grep -qs '^SECRET_KEY=' "$SERVER_DIR/.env"; then
  data_dir="${DATA_DIR:-./data}"
  case "$data_dir" in /*) ;; *) data_dir="$SERVER_DIR/$data_dir" ;; esac
  key_file="$data_dir/.secret_key"
  if [ ! -s "$key_file" ]; then
    mkdir -p "$data_dir"
    (umask 077 && "$VENV_DIR/bin/python" -c 'import secrets; print(secrets.token_hex(32))' > "$key_file")
    echo "Generated SECRET_KEY in $key_file"
  fi
  SECRET_KEY="$(cat "$key_file")"
  export SECRET_KEY
fi

# --- optional admin bootstrap ---
if [ -n "${SVIDAT_ADMIN_USER:-}" ]; then
  (cd "$SERVER_DIR" && "$VENV_DIR/bin/python" scripts/create_admin.py "$SVIDAT_ADMIN_USER")
fi

# --- backend ---
echo "Starting backend (uvicorn) on $BACKEND_HOST:$BACKEND_PORT ..."
(
  cd "$SERVER_DIR"
  exec "$VENV_DIR/bin/uvicorn" app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
PIDS+=($!)

# --- frontend (production build, served via vite preview) ---
if [ "${SKIP_BUILD:-0}" = "1" ] && [ -f "$CLIENT_DIR/dist/index.html" ]; then
  echo "SKIP_BUILD=1, using existing client/dist."
else
  echo "Building frontend..."
  (cd "$CLIENT_DIR" && VITE_API_URL="${VITE_API_URL:-/api}" npm run build)
fi

echo "Starting frontend (vite preview) on $FRONTEND_HOST:$FRONTEND_PORT ..."
(
  cd "$CLIENT_DIR"
  exec npm run preview -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
) &
PIDS+=($!)

wait
