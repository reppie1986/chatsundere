#!/usr/bin/env bash
# Configure generated development .env files for local or Tailnet access.
#
# This script is intentionally conservative:
# - it requires scripts/setup-dev.sh to have created the .env files first;
# - it changes only browser-facing URLs, CORS origins, and bind hosts;
# - it leaves generated secrets, DATABASE_URL, TEST_DATABASE_URL, REDIS_URL,
#   and AUTH_JWKS_URL untouched.
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat <<'USAGE'
Usage:
  scripts/configure-dev-access.sh local
  scripts/configure-dev-access.sh tailnet --host <magicdns-or-dev-domain> [--scheme https]
  scripts/configure-dev-access.sh tailnet --check

Optional Tailnet URL overrides:
  --user-origin <url>   Browser origin for the user client
  --admin-origin <url>  Browser origin for direct admin-client access
  --auth-url <url>      Public auth-service base URL used by clients
  --sync-url <url>      Public sync-service base URL used by clients
  --proxy-url <url>     Public proxy-service base URL used by clients
  --bind-host <host>    Host/IP for Vite and Bun listeners; defaults to 0.0.0.0
  --include-localhost   Also allow localhost client origins in Tailnet CORS

Tailnet HTTPS is the normal cross-device workflow. Plain Tailnet HTTP is only
useful as a routing diagnostic and will not satisfy browser crypto checks.
USAGE
}

required_envs=(
  apps/auth-service/.env
  apps/sync-service/.env
  apps/proxy-service/.env
  apps/user-client/.env
  apps/admin-client/.env
)

require_envs() {
  local missing=0
  for file in "${required_envs[@]}"; do
    if [[ ! -f "$file" ]]; then
      echo "Missing $file. Run ./scripts/setup-dev.sh first." >&2
      missing=1
    fi
  done
  [[ "$missing" == 0 ]]
}

valid_host() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]] && [[ "$1" != *"://"* ]]
}

valid_scheme() {
  [[ "$1" == "http" || "$1" == "https" ]]
}

valid_url() {
  [[ "$1" =~ ^https?://[^[:space:]]+$ ]]
}

origin_of() {
  local url="$1"
  url="${url#http://}"
  url="${url#https://}"
  url="${url%%/*}"
  if [[ "$1" == https://* ]]; then
    printf 'https://%s\n' "$url"
  else
    printf 'http://%s\n' "$url"
  fi
}

set_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped=$(printf '%s' "$value" | sed 's/[&|]/\\&/g')
  if grep -qE "^#?[[:space:]]*${key}=" "$file"; then
    sed -i "s|^#*[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >>"$file"
  fi
}

get_env() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

print_effective_urls() {
  echo ""
  echo "Effective browser-facing development URLs:"
  echo "  user-client:  ${PUBLIC_USER_ORIGIN}"
  echo "  admin-client: ${PUBLIC_ADMIN_ORIGIN}"
  echo "  auth-service: ${PUBLIC_AUTH_URL}"
  echo "  sync-service: ${PUBLIC_SYNC_URL}"
  echo "  proxy-service:${PUBLIC_PROXY_URL}"
  echo ""
  echo "Auth canonical API_BASE_URL:"
  echo "  $(get_env apps/auth-service/.env API_BASE_URL)"
}

configure_local() {
  require_envs

  PUBLIC_USER_ORIGIN="http://localhost:3000"
  PUBLIC_ADMIN_ORIGIN="http://localhost:5174"
  PUBLIC_AUTH_URL="http://localhost:3100"
  PUBLIC_SYNC_URL="http://localhost:3200"
  PUBLIC_PROXY_URL="http://localhost:3300"

  set_env apps/auth-service/.env BIND_HOST 127.0.0.1
  set_env apps/sync-service/.env BIND_HOST 127.0.0.1
  set_env apps/proxy-service/.env BIND_HOST 127.0.0.1
  set_env apps/auth-service/.env API_BASE_URL "${PUBLIC_AUTH_URL}/auth"
  set_env apps/auth-service/.env CORS_ALLOWED_ORIGINS "${PUBLIC_USER_ORIGIN},${PUBLIC_ADMIN_ORIGIN}"

  set_env apps/user-client/.env DEV_BIND_HOST 127.0.0.1
  set_env apps/user-client/.env DEV_ALLOWED_HOSTS ""
  set_env apps/user-client/.env VITE_DEFAULT_BASE_URL "$PUBLIC_AUTH_URL"
  set_env apps/user-client/.env VITE_AUTH_URL "$PUBLIC_AUTH_URL"
  set_env apps/user-client/.env VITE_SYNC_URL "$PUBLIC_SYNC_URL"
  set_env apps/user-client/.env VITE_PROXY_URL "$PUBLIC_PROXY_URL"

  set_env apps/admin-client/.env DEV_BIND_HOST 127.0.0.1
  set_env apps/admin-client/.env DEV_ALLOWED_HOSTS ""
  set_env apps/admin-client/.env VITE_AUTH_URL "$PUBLIC_AUTH_URL"
  set_env apps/admin-client/.env VITE_SYNC_URL "$PUBLIC_SYNC_URL"
  set_env apps/admin-client/.env VITE_PROXY_URL "$PUBLIC_PROXY_URL"

  print_effective_urls
}

check_tailnet() {
  require_envs
  local api_base
  local cors
  api_base="$(get_env apps/auth-service/.env API_BASE_URL)"
  cors="$(get_env apps/auth-service/.env CORS_ALLOWED_ORIGINS)"
  if [[ "$api_base" != https://* ]]; then
    echo "Tailnet profile is not configured for HTTPS API_BASE_URL." >&2
    echo "Run: ./scripts/configure-dev-access.sh tailnet --host <magicdns-or-dev-domain>" >&2
    exit 1
  fi
  if [[ -z "$cors" || "$cors" == *"*"* ]]; then
    echo "Tailnet profile requires exact CORS origins and never '*'. Current: ${cors}" >&2
    exit 1
  fi
  PUBLIC_USER_ORIGIN="${cors%%,*}"
  local remaining_origins="${cors#*,}"
  if [[ "$remaining_origins" != "$cors" ]]; then
    PUBLIC_ADMIN_ORIGIN="${remaining_origins%%,*}"
  else
    PUBLIC_ADMIN_ORIGIN="$PUBLIC_USER_ORIGIN"
  fi
  PUBLIC_AUTH_URL="$(get_env apps/user-client/.env VITE_AUTH_URL)"
  PUBLIC_SYNC_URL="$(get_env apps/user-client/.env VITE_SYNC_URL)"
  PUBLIC_PROXY_URL="$(get_env apps/user-client/.env VITE_PROXY_URL)"
  print_effective_urls
}

configure_tailnet() {
  require_envs

  local host=""
  local scheme="https"
  local bind_host="0.0.0.0"
  local user_origin=""
  local admin_origin=""
  local auth_url=""
  local sync_url=""
  local proxy_url=""
  local include_localhost=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host)
        host="${2:-}"
        shift 2
        ;;
      --scheme)
        scheme="${2:-}"
        shift 2
        ;;
      --bind-host)
        bind_host="${2:-}"
        shift 2
        ;;
      --user-origin)
        user_origin="${2:-}"
        shift 2
        ;;
      --admin-origin)
        admin_origin="${2:-}"
        shift 2
        ;;
      --auth-url)
        auth_url="${2:-}"
        shift 2
        ;;
      --sync-url)
        sync_url="${2:-}"
        shift 2
        ;;
      --proxy-url)
        proxy_url="${2:-}"
        shift 2
        ;;
      --include-localhost)
        include_localhost=1
        shift
        ;;
      *)
        usage >&2
        exit 64
        ;;
    esac
  done

  if [[ -z "$host" ]] || ! valid_host "$host"; then
    echo "Tailnet profile requires --host <magicdns-or-dev-domain>." >&2
    exit 64
  fi
  if ! valid_scheme "$scheme"; then
    echo "Invalid --scheme: $scheme" >&2
    exit 64
  fi
  if [[ "$scheme" != "https" ]]; then
    echo "Refusing to configure Tailnet as the normal workflow without HTTPS." >&2
    echo "Use HTTP only manually for routing diagnostics." >&2
    exit 64
  fi
  if ! valid_host "$bind_host"; then
    echo "Invalid --bind-host: $bind_host" >&2
    exit 64
  fi

  PUBLIC_USER_ORIGIN="${user_origin:-${scheme}://${host}}"
  PUBLIC_ADMIN_ORIGIN="${admin_origin:-${PUBLIC_USER_ORIGIN}}"
  PUBLIC_AUTH_URL="${auth_url:-${scheme}://${host}}"
  PUBLIC_SYNC_URL="${sync_url:-${scheme}://${host}}"
  PUBLIC_PROXY_URL="${proxy_url:-${scheme}://${host}}"

  for url in "$PUBLIC_USER_ORIGIN" "$PUBLIC_ADMIN_ORIGIN" "$PUBLIC_AUTH_URL" "$PUBLIC_SYNC_URL" "$PUBLIC_PROXY_URL"; do
    if ! valid_url "$url"; then
      echo "Invalid URL: $url" >&2
      exit 64
    fi
  done

  local cors_origins
  local user_cors_origin
  local admin_cors_origin
  user_cors_origin="$(origin_of "$PUBLIC_USER_ORIGIN")"
  admin_cors_origin="$(origin_of "$PUBLIC_ADMIN_ORIGIN")"
  if [[ "$user_cors_origin" == "$admin_cors_origin" ]]; then
    cors_origins="$user_cors_origin"
  else
    cors_origins="${user_cors_origin},${admin_cors_origin}"
  fi
  if [[ "$include_localhost" == 1 ]]; then
    cors_origins="${cors_origins},http://localhost:3000,http://localhost:5174"
  fi

  set_env apps/auth-service/.env BIND_HOST "$bind_host"
  set_env apps/sync-service/.env BIND_HOST "$bind_host"
  set_env apps/proxy-service/.env BIND_HOST "$bind_host"
  set_env apps/auth-service/.env API_BASE_URL "${PUBLIC_AUTH_URL}/auth"
  set_env apps/auth-service/.env CORS_ALLOWED_ORIGINS "$cors_origins"

  set_env apps/user-client/.env DEV_BIND_HOST "$bind_host"
  set_env apps/user-client/.env DEV_ALLOWED_HOSTS "$host"
  set_env apps/user-client/.env VITE_DEFAULT_BASE_URL "$PUBLIC_AUTH_URL"
  set_env apps/user-client/.env VITE_AUTH_URL "$PUBLIC_AUTH_URL"
  set_env apps/user-client/.env VITE_SYNC_URL "$PUBLIC_SYNC_URL"
  set_env apps/user-client/.env VITE_PROXY_URL "$PUBLIC_PROXY_URL"

  set_env apps/admin-client/.env DEV_BIND_HOST "$bind_host"
  set_env apps/admin-client/.env DEV_ALLOWED_HOSTS "$host"
  set_env apps/admin-client/.env VITE_AUTH_URL "$PUBLIC_AUTH_URL"
  set_env apps/admin-client/.env VITE_SYNC_URL "$PUBLIC_SYNC_URL"
  set_env apps/admin-client/.env VITE_PROXY_URL "$PUBLIC_PROXY_URL"

  print_effective_urls
  echo "Restart services after changing API_BASE_URL; it is part of the auth identity."
}

command="${1:-}"
case "$command" in
  local)
    shift
    [[ $# -eq 0 ]] || { usage >&2; exit 64; }
    configure_local
    ;;
  tailnet)
    shift
    if [[ "${1:-}" == "--check" ]]; then
      shift
      [[ $# -eq 0 ]] || { usage >&2; exit 64; }
      check_tailnet
    else
      configure_tailnet "$@"
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
