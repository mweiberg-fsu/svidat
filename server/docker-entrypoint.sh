#!/usr/bin/env bash
# Backend container entrypoint: the secret-key and admin-bootstrap steps from
# start.sh, then exec the CMD (uvicorn).
set -euo pipefail

# Without SECRET_KEY the backend signs JWTs with a public default; generate one
# once and keep it in the data volume so it survives container rebuilds.
if [ -z "${SECRET_KEY:-}" ]; then
  key_file="$DATA_DIR/.secret_key"
  if [ ! -s "$key_file" ]; then
    mkdir -p "$DATA_DIR"
    (umask 077 && python -c 'import secrets; print(secrets.token_hex(32))' > "$key_file")
    echo "Generated SECRET_KEY in $key_file"
  fi
  SECRET_KEY="$(cat "$key_file")"
  export SECRET_KEY
fi

if [ -n "${SVIDAT_ADMIN_USER:-}" ]; then
  python scripts/create_admin.py "$SVIDAT_ADMIN_USER"
fi

exec "$@"
