#!/usr/bin/env bash
# Generates the environment files the stack needs, with real secrets.
#
# Dev needs one .env and the example's defaults are already usable. Production needs that same .env
# (compose reads the DB role names, MinIO root credentials and image refs from it) PLUS one file per
# app, because each runtime connects as its own least-privilege Postgres role. Assembling those by
# hand means writing nine credentials and four DSNs consistently — and compose reports only the
# FIRST missing one per run, so getting it wrong costs a boot cycle per mistake.
#
# Usage:
#   ./scripts/gen-env.sh                 # dev: create .env from .env.example if absent
#   ./scripts/gen-env.sh --prod          # also write .env.{api,worker,scheduler,migration}
#   ./scripts/gen-env.sh --prod --force  # overwrite files that already exist
#   ./scripts/gen-env.sh --check         # report what is missing, write nothing
#
# Existing values are never overwritten without --force: re-running is safe, and a placeholder that
# was already replaced with a real secret stays put.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"
cd "$(sec::repo_root)"

MODE="dev"
FORCE=0
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --help | -h)
      sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --prod) MODE="prod" ;;
    --force) FORCE=1 ;;
    --check) CHECK_ONLY=1 ;;
    *)
      sec::err "Unknown argument: $arg  (try --help)"
      exit 1
      ;;
  esac
done

# openssl is not guaranteed on a dev box; node is, because the repo cannot be built without it.
random_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(${1:-24}).toString('base64url'))"
}

# Reads a key from .env, returning empty when absent or commented out.
env_value() {
  [[ -f .env ]] || return 0
  sed -nE "s/^${1}=(.*)$/\1/p" .env | tail -1
}

# Sets a key in .env: replaces the line when present, appends when not. Values are written verbatim,
# so anything containing '&' or '\' would corrupt a sed replacement — assignment goes through awk.
set_env_value() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    awk -v key="$key" -v value="$value" \
      'BEGIN { FS = "=" } $1 == key { print key "=" value; next } { print }' .env > .env.tmp
    mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

# Fills a key only when it is missing or still holds the example's placeholder.
ensure_secret() {
  local key="$1" bytes="${2:-24}" current
  current="$(env_value "$key")"
  if [[ -n "$current" && $FORCE -eq 0 ]]; then
    return 0
  fi
  set_env_value "$key" "$(random_secret "$bytes")"
  GENERATED+=("$key")
}

ensure_value() {
  local key="$1" value="$2" current
  current="$(env_value "$key")"
  if [[ -n "$current" && $FORCE -eq 0 ]]; then
    return 0
  fi
  set_env_value "$key" "$value"
  GENERATED+=("$key")
}

write_file() {
  local path="$1" content="$2"
  if [[ -f "$path" && $FORCE -eq 0 ]]; then
    sec::warn "$path exists — left untouched (use --force to regenerate)"
    return 0
  fi
  printf '%s\n' "$content" > "$path"
  chmod 600 "$path" 2>/dev/null || true
  WROTE+=("$path")
}

GENERATED=()
WROTE=()

# ---------------------------------------------------------------------------
# .env — used by every mode. Compose interpolates from it; the dev stack reads it directly.
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  if [[ $CHECK_ONLY -eq 1 ]]; then
    sec::err ".env is missing — run ./scripts/gen-env.sh to create it"
    exit 1
  fi
  cp .env.example .env
  sec::ok "Created .env from .env.example"
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  MISSING=()
  for key in BETTER_AUTH_SECRET POSTGRES_ADMIN_USER POSTGRES_ADMIN_PASSWORD \
    API_DB_USER API_DB_PASSWORD WORKER_DB_USER WORKER_DB_PASSWORD \
    SCHEDULER_DB_USER SCHEDULER_DB_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD; do
    [[ -n "$(env_value "$key")" ]] || MISSING+=("$key")
  done
  if [[ ${#MISSING[@]} -eq 0 ]]; then
    sec::ok "All production-required keys are present in .env"
  else
    sec::warn "Missing from .env: ${MISSING[*]}"
    sec::log "Run ./scripts/gen-env.sh --prod to fill them in."
  fi
  for f in .env.api .env.worker .env.scheduler .env.migration; do
    [[ -f "$f" ]] && sec::ok "$f present" || sec::warn "$f missing (needed by compose.prod.yml)"
  done
  exit 0
fi

# A dev secret still has to be a real secret: BETTER_AUTH_SECRET signs session cookies, and the
# example ships a placeholder that would otherwise be shared by every clone of this repo.
ensure_secret BETTER_AUTH_SECRET 32

if [[ "$MODE" == "dev" ]]; then
  sec::ok "Dev environment ready."
  [[ ${#GENERATED[@]} -gt 0 ]] && sec::log "Generated: ${GENERATED[*]}"
  sec::log "Next: ./scripts/doctor.sh && ./scripts/build-dev.sh"
  exit 0
fi

# ---------------------------------------------------------------------------
# Production: role credentials in .env, then one env file per runtime.
# ---------------------------------------------------------------------------
POSTGRES_DB_VALUE="$(env_value POSTGRES_DB)"
POSTGRES_DB_VALUE="${POSTGRES_DB_VALUE:-nestjs_db}"
ensure_value POSTGRES_DB "$POSTGRES_DB_VALUE"

# db-grants provisions these three roles; each app then connects as exactly one of them.
ensure_value POSTGRES_ADMIN_USER postgres
ensure_secret POSTGRES_ADMIN_PASSWORD 24
ensure_value API_DB_USER api_user
ensure_secret API_DB_PASSWORD 24
ensure_value WORKER_DB_USER worker_user
ensure_secret WORKER_DB_PASSWORD 24
ensure_value SCHEDULER_DB_USER scheduler_user
ensure_secret SCHEDULER_DB_PASSWORD 24

ensure_value MINIO_ROOT_USER minio_admin
ensure_secret MINIO_ROOT_PASSWORD 24
ensure_value STORAGE_BUCKET uploads
ensure_secret BULL_BOARD_PASSWORD 18
ensure_value BULL_BOARD_USER admin

ADMIN_USER="$(env_value POSTGRES_ADMIN_USER)"
ADMIN_PASSWORD="$(env_value POSTGRES_ADMIN_PASSWORD)"
DB_NAME="$(env_value POSTGRES_DB)"
AUTH_SECRET="$(env_value BETTER_AUTH_SECRET)"
MINIO_USER="$(env_value MINIO_ROOT_USER)"
MINIO_PASSWORD="$(env_value MINIO_ROOT_PASSWORD)"
BUCKET="$(env_value STORAGE_BUCKET)"
BOARD_USER="$(env_value BULL_BOARD_USER)"
BOARD_PASSWORD="$(env_value BULL_BOARD_PASSWORD)"

# Passwords are generated base64url, so they carry no character the DSN would have to escape.
dsn_for() {
  printf 'postgresql://%s:%s@postgres:5432/%s' "$1" "$2" "$DB_NAME"
}

API_DSN="$(dsn_for "$(env_value API_DB_USER)" "$(env_value API_DB_PASSWORD)")"
WORKER_DSN="$(dsn_for "$(env_value WORKER_DB_USER)" "$(env_value WORKER_DB_PASSWORD)")"
SCHEDULER_DSN="$(dsn_for "$(env_value SCHEDULER_DB_USER)" "$(env_value SCHEDULER_DB_PASSWORD)")"
ADMIN_DSN="$(dsn_for "$ADMIN_USER" "$ADMIN_PASSWORD")"

SHARED_STORAGE="STORAGE_ENDPOINT=http://minio:9000
STORAGE_ACCESS_KEY=${MINIO_USER}
STORAGE_SECRET_KEY=${MINIO_PASSWORD}
STORAGE_BUCKET=${BUCKET}
STORAGE_REGION=us-east-1"

SHARED_MAIL="MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_DEFAULT_EMAIL=noreply@example.com"

write_file .env.api "# Generated by scripts/gen-env.sh — the api connects as its own least-privilege role.
NODE_ENV=production
PORT=3000
DATABASE_URL=${API_DSN}
BETTER_AUTH_SECRET=${AUTH_SECRET}
# Both must point at real hosts before this is exposed: BETTER_AUTH_URL is the api origin and
# FRONTEND_BASE_URL is the SPA that renders the reset/verify/delete pages linked from emails.
BETTER_AUTH_URL=http://localhost:3000
FRONTEND_BASE_URL=http://localhost:4200
CORS_ORIGINS=http://localhost:4200
# Durable, crash-safe domain events — required in production by env validation.
EVENT_PUBLISHER_DRIVER=outbox
${SHARED_STORAGE}
${SHARED_MAIL}
BULL_BOARD_USER=${BOARD_USER}
BULL_BOARD_PASSWORD=${BOARD_PASSWORD}
# Empty fails closed (no metrics). Widen to your pod CIDR when scraping from outside the host.
METRICS_ALLOW_CIDRS=127.0.0.1/32"

write_file .env.worker "# Generated by scripts/gen-env.sh — the worker connects as its own least-privilege role.
NODE_ENV=production
DATABASE_URL=${WORKER_DSN}
BETTER_AUTH_SECRET=${AUTH_SECRET}
FRONTEND_BASE_URL=http://localhost:4200
${SHARED_STORAGE}
${SHARED_MAIL}
# Uploads are scanned before they leave quarantine; env validation requires this in production.
MALWARE_SCANNER_ENABLED=true
MALWARE_SCANNER_HOST=malware-scanner
MALWARE_SCANNER_PORT=3310"

write_file .env.scheduler "# Generated by scripts/gen-env.sh — the scheduler connects as its own least-privilege role.
NODE_ENV=production
DATABASE_URL=${SCHEDULER_DSN}
BETTER_AUTH_SECRET=${AUTH_SECRET}
EVENT_PUBLISHER_DRIVER=outbox
${SHARED_STORAGE}
${SHARED_MAIL}"

write_file .env.migration "# Generated by scripts/gen-env.sh — migrations run as the admin role that owns the schema.
NODE_ENV=production
DATABASE_URL=${ADMIN_DSN}
# DDL is session-scoped, so it must bypass a transaction-mode pooler when one is deployed.
DATABASE_DIRECT_URL=${ADMIN_DSN}
RUN_SEED=false"

echo ""
sec::ok "Production environment ready."
[[ ${#GENERATED[@]} -gt 0 ]] && sec::log "Generated secrets in .env: ${GENERATED[*]}"
[[ ${#WROTE[@]} -gt 0 ]] && sec::log "Wrote: ${WROTE[*]}"
sec::warn "These files contain real credentials and are gitignored — never commit them."
sec::log "Before exposing this stack, replace BETTER_AUTH_URL / FRONTEND_BASE_URL / CORS_ORIGINS"
sec::log "and MAIL_* in .env.api and .env.worker with your real hosts."
sec::log "Next: ./scripts/build-prod.sh"
