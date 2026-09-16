#!/usr/bin/env bash
# Hot-reload dev loop: infrastructure in Docker, the app on the host.
#
# Why not docker compose? The `*-dev` image stages run `node dist/.../main.js`
# with no source tree mounted, so editing source means rebuilding an image.
# Nx serve runs Webpack watch and restarts Node on the host while
# Postgres/Redis/MinIO/Mailpit
# stay in their containers. `.env` already points every connection at
# localhost, and compose.dev.yml overrides those same vars to service names for
# the containerised api — so the two modes coexist without editing .env.
#
# Usage:
#   ./scripts/dev.sh [APP] [--no-infra] [--down] [--help]
#
# Arguments:
#   APP           App to hot-reload (default: api). e.g. api | worker | scheduler
#
# Flags:
#   --no-infra    Assume infra is already up; skip the Docker boot + migrate.
#   --down        Tear the infra containers down when the loop exits (Ctrl-C).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"
cd "$(sec::repo_root)"
sec::source_env API_DEBUG_PORT POSTGRES_PORT POSTGRES_DB \
  API_DB_USER API_DB_PASSWORD WORKER_DB_USER WORKER_DB_PASSWORD \
  SCHEDULER_DB_USER SCHEDULER_DB_PASSWORD

APP="api"
NO_INFRA=0
DOWN_ON_EXIT=0
CLEANED_UP=0

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --no-infra) NO_INFRA=1 ;;
    --down)     DOWN_ON_EXIT=1 ;;
    --*)        sec::err "Unknown flag: $arg  (try --help)"; exit 1 ;;
    *)          APP="$arg" ;;
  esac
done

case "$APP" in
  api|worker|scheduler) ;;
  *) sec::err "Unsupported hot-reload app: $APP (expected api, worker, or scheduler)"; exit 1 ;;
esac

# Same compose invocation as build-dev.sh: --env-file is required because the
# compose files live under docker/, so host-side ${VAR:-default} interpolation
# would otherwise miss the root .env.
COMPOSE_ARGS=(--env-file .env -f docker/compose.yml -f docker/compose.dev.yml)

# Infra only — never the app services (api/worker/scheduler run on the host).
INFRA_SERVICES=(postgres redis-cache redis-queue minio mailpit)

cleanup() {
  [[ $CLEANED_UP -eq 1 ]] && return
  CLEANED_UP=1
  if [[ $DOWN_ON_EXIT -eq 1 ]]; then
    sec::log "Stopping infra containers"
    # shellcheck disable=SC2086
    docker compose "${COMPOSE_ARGS[@]}" stop "${INFRA_SERVICES[@]}" 2>/dev/null || true
  else
    sec::log "Infra left running — stop it with: ./scripts/teardown.sh --keep-volumes"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $NO_INFRA -eq 0 ]]; then
  if ! docker info >/dev/null 2>&1; then
    sec::err "Docker daemon unreachable. Start Docker, or pass --no-infra if infra runs elsewhere."
    exit 1
  fi

  sec::log "Starting infra: ${INFRA_SERVICES[*]}"
  # --wait blocks until each service passes its healthcheck, so migrate + the
  # app connect to a ready Postgres/Redis instead of racing the boot.
  # shellcheck disable=SC2086
  docker compose "${COMPOSE_ARGS[@]}" up -d --wait "${INFRA_SERVICES[@]}"

  # One-shot: creates the MinIO bucket the upload module expects. Idempotent.
  # shellcheck disable=SC2086
  docker compose "${COMPOSE_ARGS[@]}" up --no-log-prefix minio-init

  # Apply migrations from the host (DATABASE_URL already points at localhost).
  # `deploy` only runs committed migrations — no schema drift prompts.
  sec::log "Applying migrations (prisma migrate deploy)"
  pnpm exec prisma migrate deploy

  # --no-deps because the compose `migration` service is not used on this path — migrations were
  # just applied from the host, and pulling it in would build an image this flow never runs.
  sec::log "Provisioning runtime database roles (db-grants)"
  # shellcheck disable=SC2086
  docker compose "${COMPOSE_ARGS[@]}" up --no-deps --no-log-prefix --exit-code-from db-grants db-grants
fi

# nx serve starts the Node inspector on 9229 by default, so hot-reloading more
# than one app on the host collides. Give each known app a distinct debug port;
# anything else gets a random free port (--port=0).
case "$APP" in
  api)       INSPECT_PORT="${API_DEBUG_PORT:-9229}" ;;
  worker)    INSPECT_PORT=9230 ;;
  scheduler) INSPECT_PORT=9231 ;;
  *)         INSPECT_PORT=0 ;;
esac

# Every app on the host reads the same .env, which holds the api's name.
if [[ "$APP" != "api" ]]; then
  export OTEL_SERVICE_NAME="nestjs-fastify-${APP}"
fi

# .env keeps the admin DSN for the Prisma CLI; the app connects as its own runtime role.
case "$APP" in
  api) ROLE_USER="${API_DB_USER:-api_user}"; ROLE_PASSWORD="${API_DB_PASSWORD:-}" ;;
  worker) ROLE_USER="${WORKER_DB_USER:-worker_user}"; ROLE_PASSWORD="${WORKER_DB_PASSWORD:-}" ;;
  scheduler) ROLE_USER="${SCHEDULER_DB_USER:-scheduler_user}"; ROLE_PASSWORD="${SCHEDULER_DB_PASSWORD:-}" ;;
  *) ROLE_USER=""; ROLE_PASSWORD="" ;;
esac

if [[ -n "$ROLE_USER" ]]; then
  if [[ -z "$ROLE_PASSWORD" ]]; then
    sec::err "No password for '${ROLE_USER}' — run ./scripts/gen-env.sh to generate the runtime role credentials."
    exit 1
  fi
  export DATABASE_URL="postgresql://$(sec::urlencode "$ROLE_USER"):$(sec::urlencode "$ROLE_PASSWORD")@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-nestjs_db}"
  sec::log "  database role: ${ROLE_USER} (admin DSN stays in .env for the Prisma CLI)"
fi

sec::ok "Infra ready. Booting hot-reload loop for '${APP}'."
sec::log "  runner: nx serve ${APP} (Webpack watch, inspector ${INSPECT_PORT})"
echo ""

# @nx/js:node owns the build watcher and child lifecycle. Keeping one foreground
# process makes Ctrl-C and error propagation reliable and avoids duplicate builds.
pnpm exec nx serve "$APP" --port="$INSPECT_PORT" --output-style=stream
