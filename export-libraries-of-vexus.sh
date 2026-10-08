#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"
port="${DICECLOUD_CDP_PORT:-9222}"
cdp_url="${DICECLOUD_CDP_URL:-http://127.0.0.1:${port}}"
chromium_bin="${CHROMIUM_BIN:-chromium}"
profile_dir="${DICECLOUD_PROFILE_DIR:-$root/.dicecloud-export-profile}"

if ! curl --silent --fail "${cdp_url}/json/version" >/dev/null; then
  "$chromium_bin" --remote-debugging-port="$port" --user-data-dir="$profile_dir" \
    'https://dicecloud.com/community-libraries' >/dev/null 2>&1 &
fi

echo 'Log into DiceCloud in the opened Chromium window. No site data will be modified.'
read -r -p 'Press Enter once login is complete: '
DICECLOUD_CDP_URL="$cdp_url" node tools/export-dicecloud-library-collections.js \
  exports/dicecloud-library-collection-jp6xTaHDZK4ELYzvN.json \
  exports/dicecloud-library-collection-5EKp4S55tDzRivSLn.json
echo "Export finished successfully. Local files are in: $root/exports/libraries-of-vexus"
