#!/usr/bin/env bash
# Sync ship netCDF data from the SAMOS processing server into server/data/raw/.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT_DIR/server/scripts/get_data.sh" "$@"
