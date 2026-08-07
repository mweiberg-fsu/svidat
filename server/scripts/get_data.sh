#!/usr/bin/env bash
# Sync ship netCDF files from the SAMOS processing server into server/data/raw/.
# Only missing or changed files are transferred (rsync compares size + mtime).
#
# The remote tree is nested (research/<SHIP>/<YEAR>/<SHIP>_<DATE>v<VER>.nc), but
# the backend's /files/catalog + raw_path() treat server/data/raw/ as flat,
# keyed only by filename (see app/routers/files.py, app/storage.py). Filenames
# already encode ship+date+version uniquely, so we mirror the remote tree into
# a staging dir, then symlink-flatten every *.nc into DEST_DIR to match that
# contract without touching backend code.
set -euo pipefail

REMOTE_HOST="samosdev-proc.coaps.fsu.edu"
REMOTE_PATH="/Net/samosdev/data/processing/research/"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
DEST_DIR="${DEST_DIR:-$SERVER_DIR/data/raw}"
STAGING_DIR="${STAGING_DIR:-$SERVER_DIR/data/.raw_sync}"

if ! command -v rsync >/dev/null 2>&1; then
    echo "Error: rsync not found. Install it (e.g. 'brew install rsync' or 'apt install rsync')." >&2
    exit 1
fi

read -rp "SSH username for ${REMOTE_HOST}: " SSH_USER
if [[ -z "$SSH_USER" ]]; then
    echo "Error: username required." >&2
    exit 1
fi

mkdir -p "$STAGING_DIR" "$DEST_DIR"

echo "Syncing from ${SSH_USER}@${REMOTE_HOST}:${REMOTE_PATH}"
echo "       into  ${STAGING_DIR} (nested, mirrors remote)"
echo "(you may be prompted for an SSH password if no key/agent is configured)"

# -a: archive (recurse, preserve perms/times); -v: verbose; -z: compress;
# -h: human-readable; --progress: per-file progress.
# No --delete: local files absent on remote are left alone.
rsync -avzh --progress \
    -e "ssh -o BatchMode=no" \
    --include="*/" --include="*.nc" --exclude="*" \
    "${SSH_USER}@${REMOTE_HOST}:${REMOTE_PATH}" \
    "$STAGING_DIR/"

echo "Flattening into ${DEST_DIR} ..."
new_links=0
while IFS= read -r -d '' src; do
    link="$DEST_DIR/$(basename "$src")"
    if [[ ! -L "$link" || "$(readlink "$link")" != "$src" ]]; then
        ln -sf "$src" "$link"
        new_links=$((new_links + 1))
    fi
done < <(find "$STAGING_DIR" -name '*.nc' -print0)

echo "Done. ${new_links} new/updated link(s) in ${DEST_DIR}."
