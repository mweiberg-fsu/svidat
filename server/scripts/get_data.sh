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
#
# Synced and flattened one <ship>/<year> directory at a time (rather than one
# big rsync + one final flatten) so the catalog picks up newly-downloaded
# ships/years as they complete, instead of only after the entire remote tree
# — which can be a long first-time download — finishes.
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

echo "Listing ship/year directories on ${REMOTE_HOST} ..."
# One remote find call (not one ssh round-trip per ship) — %P prints paths
# relative to REMOTE_PATH, e.g. "WTDF/2020".
mapfile -t SHIP_YEARS < <(
    ssh -o BatchMode=no "${SSH_USER}@${REMOTE_HOST}" \
        "find '${REMOTE_PATH}' -mindepth 2 -maxdepth 2 -type d -printf '%P\n'" | sort
)

if [[ ${#SHIP_YEARS[@]} -eq 0 ]]; then
    echo "Error: no ship/year directories found under ${REMOTE_PATH}." >&2
    exit 1
fi

echo "Found ${#SHIP_YEARS[@]} ship/year directories."
echo "(you may be prompted for an SSH password if no key/agent is configured)"

# Flattens every *.nc found under $1 (a STAGING_DIR subtree) into DEST_DIR,
# symlinking only entries that are missing or stale. Python (not a bash loop
# calling `ln` per file) since a single ship/year batch can still be a few
# thousand files and per-process fork overhead adds up fast at that count.
flatten() {
    python3 -c "
import os, sys
staging, dest = sys.argv[1], sys.argv[2]
count = 0
for root, _dirs, files in os.walk(staging):
    for f in files:
        if not f.endswith('.nc'):
            continue
        src = os.path.join(root, f)
        link = os.path.join(dest, f)
        try:
            current = os.readlink(link)
        except OSError:
            current = None
        if current != src:
            if os.path.lexists(link):
                os.remove(link)
            os.symlink(src, link)
            count += 1
print(f'  +{count} linked')
" "$1" "$DEST_DIR"
}

total=${#SHIP_YEARS[@]}
i=0
for ship_year in "${SHIP_YEARS[@]}"; do
    i=$((i + 1))
    echo "[$i/$total] ${ship_year}"

    # -a: archive (recurse, preserve perms/times); -z: compress.
    # No --delete: local files absent on remote are left alone.
    rsync -azh \
        -e "ssh -o BatchMode=no" \
        --include="*/" --include="*.nc" --exclude="*" \
        "${SSH_USER}@${REMOTE_HOST}:${REMOTE_PATH}${ship_year}/" \
        "$STAGING_DIR/${ship_year}/"

    flatten "$STAGING_DIR/${ship_year}"
done

echo "Done. ${DEST_DIR} is up to date with $total ship/year director$([ "$total" -eq 1 ] && echo y || echo ies)."
