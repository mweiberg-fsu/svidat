#!/usr/bin/env bash
# Launch backend (uvicorn) and frontend (vite preview, built) servers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"
VENV_DIR="$SERVER_DIR/.venv"

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

# --- backend ---
if [ ! -x "$VENV_DIR/bin/uvicorn" ]; then
  echo "Backend venv not found at $VENV_DIR. Run 'python3 install.py' first." >&2
  exit 1
fi
echo "Starting backend (uvicorn) on :$BACKEND_PORT ..."
(
  cd "$SERVER_DIR"
  exec "$VENV_DIR/bin/uvicorn" app.main:app --host 0.0.0.0 --port "$BACKEND_PORT"
) &
PIDS+=($!)

# --- frontend (production build, served via vite preview) ---
echo "Building frontend..."
(cd "$CLIENT_DIR" && npm run build)

echo "Starting frontend (vite preview) on :$FRONTEND_PORT ..."
(
  cd "$CLIENT_DIR"
  exec npm run preview -- --host 0.0.0.0 --port "$FRONTEND_PORT"
) &
PIDS+=($!)

wait
