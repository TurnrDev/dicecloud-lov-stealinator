#!/usr/bin/env bash
set -euo pipefail

username="${1:?Usage: ./restore-libraries-of-vexus-local.sh <local-username>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="${DICECLOUD_COMPOSE_FILE:-${DICECLOUD_DEV_COMPOSE:-$root/../HoardDC/docker-compose.yml}}"
mongo_service="${DICECLOUD_MONGO_SERVICE:-db}"

run_mongosh() {
  # Credentials are read from the Mongo container's own environment, rather
  # than copied from the host's private .env file or hard-coded for dev.
  docker compose -f "$compose_file" exec -T "$mongo_service" sh -lc \
    'mongosh --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin dicecloud --file /dev/stdin'
}

restore_one() {
  local export_file="$1"
  node "$root/tools/emit-local-restore.js" "$export_file" "$username" --replace \
    | run_mongosh
}

count=0
while IFS= read -r export_file; do
  echo "Restoring $(basename "$export_file" .json)…"
  restore_one "$export_file"
  count=$((count + 1))
done < <(find "$root/exports/libraries-of-vexus" -mindepth 2 -maxdepth 2 -name '*.json' ! -name 'export-manifest.json' -type f | sort)

for manifest in "$root"/exports/dicecloud-library-collection-*.json; do
  node "$root/tools/emit-local-collection-restore.js" "$manifest" "$username" \
    | run_mongosh
done

echo "Restore complete: $count libraries and 2 collections. Refresh DiceCloud."
