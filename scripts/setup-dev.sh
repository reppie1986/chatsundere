#!/usr/bin/env bash
# Local development bootstrap for Chatsundere.
#
# Idempotent: re-run safely. Existing .env files and secrets are preserved.
# No arguments keeps the original light setup behaviour: create missing .env
# files, top up empty dev secrets, and stop. The optional access profiles add
# the repeatable "make this checkout runnable" steps used after upstream merges.
set -euo pipefail

cd "$(dirname "$0")/.."

apps=(auth-service sync-service proxy-service user-client admin-client)

usage() {
  cat <<'USAGE'
Usage:
  scripts/setup-dev.sh
  scripts/setup-dev.sh local [--skip-build-packages]
  scripts/setup-dev.sh tailnet --host <magicdns-or-dev-domain> [--host <extra-host>]

Tailnet mode performs the personal dev bootstrap:
  1. create missing .env files and dev secrets
  2. configure browser-facing HTTPS hosts and exact CORS origins
  3. start dev Postgres and Redis
  4. ensure dev databases exist
  5. run available service migrations
  6. build workspace packages

Options:
  --skip-infra           Do not start docker compose services
  --skip-databases       Do not create missing dev databases
  --skip-migrations      Do not run service db:migrate scripts
  --skip-build-packages  Do not run pnpm build:packages

For more URL options, run:
  scripts/configure-dev-access.sh --help
USAGE
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 127
  fi
}

# auth-service ships its secret placeholders empty in .env.example (they must
# never be committed). These keys are validated with minLength(40), so a plain
# copy leaves the service unbootable until they are filled. Generate a 32-byte
# base64url value per key - that is exactly the shape auth-service expects for
# both the Ed25519 seed and the HMAC keys. Dev-only secrets; regenerate freely.
gen_secret() {
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
}

# Fill any empty `KEY=` assignment for the given keys in the given file, in
# place. Non-empty values are left untouched, so this stays idempotent and also
# repairs a .env left half-filled by an earlier run of this script.
fill_empty_secrets() {
  local file="$1"
  shift
  for key in "$@"; do
    if grep -qE "^${key}=$" "$file"; then
      local value
      value="$(gen_secret)"
      sed -i "s|^${key}=$|${key}=${value}|" "$file"
      echo "  -> generated ${key}"
    fi
  done
}

create_env_files() {
  require_command openssl

  for app in "${apps[@]}"; do
    local example="apps/${app}/.env.example"
    local env_file="apps/${app}/.env"
    if [[ ! -f "$example" ]]; then
      echo "Missing ${example} - is this the project root?" >&2
      exit 1
    fi
    if [[ -f "$env_file" ]]; then
      echo "OK ${env_file} exists - leaving it alone."
    else
      cp "$example" "$env_file"
      echo "OK Created ${env_file}"
    fi
    # Always top up empty secrets, whether the file is fresh or pre-existing.
    if [[ "$app" == "auth-service" ]]; then
      fill_empty_secrets "$env_file" \
        AUTH_JWT_PRIVATE_KEY \
        INVITATION_HMAC_KEY \
        REFRESH_TOKEN_HMAC_KEY \
        HMAC_KEY_PENDING_CODES
    fi
  done

  mkdir -p infra/data
  echo "OK Ensured infra/data/ exists (Docker creates per-service subdirs)"
}

start_dev_infra() {
  require_command docker
  echo ""
  echo "=== Starting dev Postgres and Redis ==="
  docker compose -f infra/compose.dev.yml up -d postgres redis
}

wait_for_postgres() {
  require_command docker
  echo ""
  echo "=== Waiting for Postgres ==="
  local attempts=30
  local delay_seconds=2

  for attempt in $(seq 1 "$attempts"); do
    if docker compose -f infra/compose.dev.yml exec -T postgres \
      pg_isready --username chatsundere --dbname postgres >/dev/null 2>&1; then
      echo "OK Postgres is ready."
      return 0
    fi

    echo "Postgres is not ready yet (${attempt}/${attempts})..."
    sleep "$delay_seconds"
  done

  echo "Postgres did not become ready in time." >&2
  docker compose -f infra/compose.dev.yml ps postgres >&2
  return 1
}

ensure_dev_databases() {
  require_command docker
  echo ""
  echo "=== Ensuring dev databases exist ==="
  wait_for_postgres
  docker compose -f infra/compose.dev.yml exec -T postgres \
    psql -v ON_ERROR_STOP=1 --username chatsundere --dbname postgres <<'EOSQL'
SELECT 'CREATE DATABASE auth_db OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

SELECT 'CREATE DATABASE auth_db_test OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db_test')\gexec

SELECT 'CREATE DATABASE sync_db OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db')\gexec

SELECT 'CREATE DATABASE sync_db_test OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db_test')\gexec

SELECT 'CREATE DATABASE proxy_db OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'proxy_db')\gexec
EOSQL
}

run_migration_if_available() {
  local package_dir="$1"
  local package_name="$2"
  if [[ ! -f "${package_dir}/package.json" ]]; then
    echo "Skipping ${package_name}: package.json not found."
    return 0
  fi
  if grep -q '"db:migrate"' "${package_dir}/package.json"; then
    echo "Running migrations for ${package_name}"
    pnpm --filter "${package_name}" db:migrate
  else
    echo "Skipping ${package_name}: no db:migrate script."
  fi
}

run_available_migrations() {
  require_command pnpm
  echo ""
  echo "=== Running available migrations ==="
  run_migration_if_available apps/auth-service @chatsundere/auth-service
  run_migration_if_available apps/sync-service @chatsundere/sync-service
  run_migration_if_available apps/proxy-service @chatsundere/proxy-service
}

build_packages() {
  require_command pnpm
  echo ""
  echo "=== Building workspace packages ==="
  pnpm build:packages
}

mode="${1:-}"
start_infra=0
ensure_databases=0
run_migrations=0
run_build_packages=0
configure_args=()

case "$mode" in
  "")
    ;;
  local)
    shift
    configure_args=(local)
    run_build_packages=1
    ;;
  tailnet)
    shift
    configure_args=(tailnet)
    start_infra=1
    ensure_databases=1
    run_migrations=1
    run_build_packages=1
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-infra)
      start_infra=0
      shift
      ;;
    --skip-databases)
      ensure_databases=0
      shift
      ;;
    --skip-migrations)
      run_migrations=0
      shift
      ;;
    --skip-build-packages)
      run_build_packages=0
      shift
      ;;
    *)
      configure_args+=("$1")
      shift
      ;;
  esac
done

create_env_files

if [[ "${#configure_args[@]}" -gt 0 ]]; then
  echo ""
  echo "=== Configuring dev access ==="
  bash scripts/configure-dev-access.sh "${configure_args[@]}"
fi

if [[ "$start_infra" == 1 ]]; then
  start_dev_infra
fi

if [[ "$ensure_databases" == 1 ]]; then
  ensure_dev_databases
fi

if [[ "$run_migrations" == 1 ]]; then
  run_available_migrations
fi

if [[ "$run_build_packages" == 1 ]]; then
  build_packages
fi

echo ""
echo "=== Dev setup complete ==="
echo ""
if [[ "$mode" == "tailnet" ]]; then
  echo "Next steps:"
  echo "  1. Check Tailscale Serve routes for / and /api"
  echo "  2. pnpm dev:tailnet"
elif [[ "$mode" == "local" ]]; then
  echo "Next steps:"
  echo "  1. docker compose -f infra/compose.dev.yml up -d"
  echo "  2. pnpm dev:local"
else
  echo "Next steps:"
  echo "  1. direnv allow                                # if direnv is installed"
  echo "  2. docker compose -f infra/compose.dev.yml up -d"
  echo "  3. pnpm install                                # if not already done"
  echo "  4. pnpm dev                                    # starts all services + clients"
fi
