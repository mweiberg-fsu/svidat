#!/usr/bin/env bash
# Sync ship netCDF files from the SAMOS processing server into server/data/raw/.
# Only missing or changed files are transferred (rsync compares size + mtime).
set -euo pipefail

REMOTE_HOST="samosdev-proc.coaps.fsu.edu"
REMOTE_PATH="/Net/samosdev/data/processing/research/"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
DEST_DIR="${DEST_DIR:-$SERVER_DIR/data/raw}"

if ! command -v rsync >/dev/null 2>&1; then
    echo "Error: rsync not found. Install it (e.g. 'brew install rsync' or 'apt install rsync')." >&2
    exit 1
fi

read -rp "SSH username for ${REMOTE_HOST}: " SSH_USER
if [[ -z "$SSH_USER" ]]; then
    echo "Error: username required." >&2
    exit 1
fi

mkdir -p "$DEST_DIR"

echo "Syncing from ${SSH_USER}@${REMOTE_HOST}:${REMOTE_PATH}"
echo "       into  ${DEST_DIR}"
echo "(you may be prompted for an SSH password if no key/agent is configured)"

# -a: archive (recurse, preserve perms/times); -v: verbose; -z: compress;
# -h: human-readable; --progress: per-file progress.
# No --delete: local files absent on remote are left alone.
rsync -avzh --progress \
    -e "ssh -o BatchMode=no" \
    "${SSH_USER}@${REMOTE_HOST}:${REMOTE_PATH}" \
    "$DEST_DIR/"

echo "Done."
