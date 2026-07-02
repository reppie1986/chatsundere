#!/usr/bin/env bash
# Configure the hostname accepted by Vite dev servers.
#
# This is for the Vite "Blocked request. This host is not allowed" problem.
# It does not mass-rewrite application source files. The Vite configs should
# read DEV_ALLOWED_HOSTS from .env; this script updates that value.

set -euo pipefail

DEV_HOSTNAME="desktop-q26ttrq.tail58a9d0.ts.net"
DEV_BIND_HOST="0.0.0.0"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

ENV_FILES=(
  "$PROJECT_ROOT/apps/user-client/.env"
  "$PROJECT_ROOT/apps/admin-client/.env"
)

VITE_CONFIGS=(
  "$PROJECT_ROOT/apps/user-client/vite.config.ts"
  "$PROJECT_ROOT/apps/user-client/vite.config.js"
  "$PROJECT_ROOT/apps/admin-client/vite.config.ts"
  "$PROJECT_ROOT/apps/admin-client/vite.config.js"
)

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped

  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"

  if grep -qE "^#?[[:space:]]*${key}=" "$file"; then
    sed -i "s|^#*[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >>"$file"
  fi
}

if [[ -z "$DEV_HOSTNAME" || "$DEV_HOSTNAME" == *"://"* || "$DEV_HOSTNAME" == */* ]]; then
  echo "ERROR: DEV_HOSTNAME must be a bare hostname, not a URL." >&2
  exit 2
fi

echo
echo "Vite development host updater"
echo "============================="
echo
echo "Project root:    $PROJECT_ROOT"
echo "Allowed host:    $DEV_HOSTNAME"
echo "Vite bind host:  $DEV_BIND_HOST"
echo

for env_file in "${ENV_FILES[@]}"; do
  if [[ ! -f "$env_file" ]]; then
    echo "ERROR: Missing $env_file"
    echo "Run ./scripts/setup-dev.sh first."
    exit 3
  fi

  set_env_value "$env_file" DEV_BIND_HOST "$DEV_BIND_HOST"
  set_env_value "$env_file" DEV_ALLOWED_HOSTS "$DEV_HOSTNAME"
  echo "Updated $(realpath --relative-to="$PROJECT_ROOT" "$env_file")"
done

echo
echo "Checking Vite config support..."
found_config=0
missing_support=0

for config in "${VITE_CONFIGS[@]}"; do
  if [[ ! -f "$config" ]]; then
    continue
  fi

  found_config=1
  rel="$(realpath --relative-to="$PROJECT_ROOT" "$config")"
  if grep -q "allowedHosts" "$config" && grep -q "DEV_ALLOWED_HOSTS" "$config"; then
    echo "  OK: $rel reads DEV_ALLOWED_HOSTS"
  else
    echo "  WARNING: $rel does not appear to read DEV_ALLOWED_HOSTS"
    missing_support=1
  fi
done

if [[ "$found_config" == "0" ]]; then
  echo "ERROR: No Vite config files found." >&2
  exit 4
fi

echo
if [[ "$missing_support" == "1" ]]; then
  echo "One or more Vite config files need the allowedHosts wiring."
  echo "Expected server config shape:"
  echo "  allowedHosts: devAllowedHosts(env.DEV_ALLOWED_HOSTS)"
  exit 5
fi

echo "Done. Restart the Vite dev server so it picks up the updated .env values."
exit 0
