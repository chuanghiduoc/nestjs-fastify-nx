#!/usr/bin/env bash
# Hot-reload dev loop: infrastructure in Docker, the app on the host.
#
# Why not docker compose? The `*-dev` image stages run `node dist/.../main.js`
# with no file watching (see Dockerfile), so editing source means rebuilding an
# image every time. Running the app on the host with `nx watch` + `nx serve`
# instead gives sub-second rebuild → restart while Postgres/Redis/MinIO/Mailpit
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

APP="api"
NO_INFRA=0
DOWN_ON_EXIT=0

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

# Same compose invocation as build-dev.sh: --env-file is required because the
# compose files live under docker/, so host-side ${VAR:-default} interpolation
# would otherwise miss the root .env.
COMPOSE_BASE="--env-file .env -f docker/compose.yml -f docker/compose.dev.yml"

# Infra only — never the app services (api/worker/scheduler run on the host).
INFRA_SERVICES=(postgres redis-cache redis-queue minio mailpit)

cleanup() {
  # Kill the background watcher first so it doesn't try to rebuild into a
  # half-torn-down state, then optionally stop the infra.
  [[ -n "${WATCH_PID:-}" ]] && kill "$WATCH_PID" 2>/dev/null || true
  if [[ $DOWN_ON_EXIT -eq 1 ]]; then
    sec::log "Stopping infra containers"
    # shellcheck disable=SC2086
    docker compose $COMPOSE_BASE stop "${INFRA_SERVICES[@]}" 2>/dev/null || true
  else
    sec::log "Infra left running — stop it with: ./scripts/teardown.sh --keep-volumes"
  fi
}
trap cleanup INT TERM EXIT

if [[ $NO_INFRA -eq 0 ]]; then
  if ! docker info >/dev/null 2>&1; then
    sec::err "Docker daemon unreachable. Start Docker, or pass --no-infra if infra runs elsewhere."
    exit 1
  fi

  sec::log "Starting infra: ${INFRA_SERVICES[*]}"
  # --wait blocks until each service passes its healthcheck, so migrate + the
  # app connect to a ready Postgres/Redis instead of racing the boot.
  # shellcheck disable=SC2086
  docker compose $COMPOSE_BASE up -d --wait "${INFRA_SERVICES[@]}"

  # One-shot: creates the MinIO bucket the upload module expects. Idempotent.
  # shellcheck disable=SC2086
  docker compose $COMPOSE_BASE up -d minio-init >/dev/null 2>&1 || true

  # Apply migrations from the host (DATABASE_URL already points at localhost).
  # `deploy` only runs committed migrations — no schema drift prompts.
  sec::log "Applying migrations (prisma migrate deploy)"
  pnpm exec prisma migrate deploy
fi

sec::ok "Infra ready. Booting hot-reload loop for '${APP}'."
sec::log "  watcher: nx watch -> nx run ${APP}:build:development"
sec::log "  server:  nx serve ${APP}  (restarts on dist change)"
echo ""

# Watcher: rebuild the app bundle whenever the app OR any lib it depends on
# changes. Webpack pulls lib source directly via tsconfig paths, so rebuilding
# the app is enough — no need to serve each lib. Runs in the background.
pnpm exec nx watch --projects "${APP}" --includeDependentProjects -- \
  pnpm exec nx run "${APP}:build:development" &
WATCH_PID=$!

# Server: @nx/js:node is continuous and watches the build output, so when the
# watcher rewrites dist it restarts the Node process. This call stays in the
# foreground; Ctrl-C triggers the cleanup trap above.
pnpm exec nx serve "${APP}"
