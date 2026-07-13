#!/usr/bin/env bash
# Build all services in development mode using docker compose.
#
# Usage:
#   ./scripts/build-dev.sh [SERVICE...] [--with-obs] [--help]
#
# Arguments:
#   SERVICE...    One or more service names to build (default: api worker scheduler migration)
#   --with-obs    Include the observability overlay (Prometheus, Grafana, Jaeger, OTel)
#
# Env flags:
#   NO_CACHE=1       full clean rebuild (default: incremental)
#   BUILD_PARALLEL=0 build services serially on memory-constrained hosts
#   BUILD_PARALLEL_LIMIT=2 cap concurrent Compose build tasks (default: 2)
#
# Security scanning (Trivy/SBOM/etc.) is intentionally NOT run here — it lives in
# CI (.github/workflows). Local builds stay fast; run scripts/security/*.sh
# manually if you need local parity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared color helpers.
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"

# Always run from project root regardless of where the script is called from.
cd "$(sec::repo_root)"
sec::source_env COMPOSE_PROJECT_NAME API_PORT API_REPLICAS WORKER_REPLICAS

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/build-dev.sh [SERVICE...] [--with-obs] [--help]"
  echo ""
  echo "Arguments:"
  echo "  SERVICE...    Services to build (default: api worker scheduler migration)"
  echo "  --with-obs    Also start the observability stack (Prometheus/Grafana/Jaeger/OTel)"
  echo ""
  echo "Env flags:"
  echo "  NO_CACHE=1        Full clean rebuild"
  echo "  BUILD_PARALLEL=0       Build services serially (default: batched)"
  echo "  BUILD_PARALLEL_LIMIT=2 Concurrent Compose build cap"
  echo ""
  echo "Examples:"
  echo "  ./scripts/build-dev.sh"
  echo "  ./scripts/build-dev.sh api"
  echo "  ./scripts/build-dev.sh --with-obs"
  echo "  NO_CACHE=1 ./scripts/build-dev.sh api worker"
  exit 0
fi

# `migration` is built alongside the long-running services so source changes
# in prisma.config.ts / schema.prisma / prisma/migrations / apps/migration
# always pick up — compose `up` reuses any pre-existing migration image silently,
# so excluding it from the build list silently ships stale migration logic.
DEFAULT_SERVICES=(api worker scheduler migration)
WITH_OBS=0
SERVICES=()

for arg in "$@"; do
  case "$arg" in
    --with-obs) WITH_OBS=1 ;;
    --*)
      sec::err "Unknown flag: $arg  (try --help)"
      exit 1
      ;;
    *) SERVICES+=("$arg") ;;
  esac
done

if [[ ${#SERVICES[@]} -eq 0 ]]; then
  SERVICES=("${DEFAULT_SERVICES[@]}")
fi

# --env-file .env is required because the compose files live under docker/.
# Without it compose looks for `docker/.env` (not present) and every
# `${VAR:-default}` interpolation falls back to its default. The same .env
# is also injected into containers via `env_file: ../.env`; the CLI flag
# covers the host-side substitution that env_file cannot.
COMPOSE_ARGS=(--env-file .env -f docker/compose.yml -f docker/compose.dev.yml)
if [[ $WITH_OBS -eq 1 ]]; then
  COMPOSE_ARGS+=(-f docker/compose.observability.yml)
  sec::log "Observability overlay enabled (Prometheus + Grafana + Jaeger + OTel)"
fi

# --no-cache invalidates every layer (incl. pnpm install) and rebuilds the
# images from scratch. Default to incremental; set NO_CACHE=1 to force.
BUILD_FLAGS=()
if [[ "${NO_CACHE:-0}" = "1" ]]; then
  BUILD_FLAGS+=(--no-cache)
fi
# Expand BUILD_FLAGS via `"${arr[@]+"${arr[@]}"}"` below — expanding an empty array
# under `set -u` is an "unbound variable" error on bash < 4.4 (macOS ships 3.2).

# Skip BuildKit attestations (provenance + sbom) for dev images. Each one
# adds a parallel manifest that has to be exported and unpacked, doubling
# the post-build phase to no benefit on local dev images.
export BUILDX_NO_DEFAULT_ATTESTATIONS=1

sec::log "Building dev images: ${SERVICES[*]}"
BUILD_START=$(date +%s)
# A single Compose invocation lets BuildKit deduplicate the common stages.
# Limit scheduling to avoid fanning out every dependency stage at once.
if [[ "${BUILD_PARALLEL:-1}" = "1" ]]; then
  # shellcheck disable=SC2086
  COMPOSE_PARALLEL_LIMIT="${BUILD_PARALLEL_LIMIT:-2}" \
    docker compose "${COMPOSE_ARGS[@]}" build "${BUILD_FLAGS[@]+"${BUILD_FLAGS[@]}"}" "${SERVICES[@]}"
else
  for svc in "${SERVICES[@]}"; do
    sec::log "  → $svc"
    # shellcheck disable=SC2086
    docker compose "${COMPOSE_ARGS[@]}" build "${BUILD_FLAGS[@]+"${BUILD_FLAGS[@]}"}" "$svc"
  done
fi
BUILD_END=$(date +%s)
BUILD_ELAPSED=$((BUILD_END - BUILD_START))

echo ""
sec::log "Starting / recreating: ${SERVICES[*]}"

# Compose project name (used to build container names like `<project>-api-1`).
# Mirrors compose CLI default — directory basename when COMPOSE_PROJECT_NAME unset.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"
export COMPOSE_PROJECT_NAME

# Pre-clean orphans. Plain `up --force-recreate` fails with "container name
# already in use" when a previous run left containers compose no longer tracks
# (project renamed, label drift, crash mid-deploy). `rm -sf` is a no-op when
# the service is unknown; `docker rm -f` covers the unlabelled-orphan case.
docker compose "${COMPOSE_ARGS[@]}" rm -sf "${SERVICES[@]}" 2>/dev/null || true
for svc in "${SERVICES[@]}"; do
  # Match all replicas, not just -1, in case API_REPLICAS / WORKER_REPLICAS > 1.
  # Docker's --filter name uses Go RE2, where `+` is the quantifier — GNU BRE's
  # `\+` would match a literal '+' here and silently never match a real container.
  stale=$(docker ps -aq --filter "name=^${COMPOSE_PROJECT_NAME}-${svc}-[0-9]+$" 2>/dev/null || true)
  # shellcheck disable=SC2086  # intentional word-split: $stale is a space-separated id list
  [[ -n "$stale" ]] && docker rm -f $stale 2>/dev/null || true
done

# API_REPLICAS / WORKER_REPLICAS only take effect in Swarm (deploy.replicas is
# ignored by plain `docker compose up`); the passthrough keeps them visible in
# the process environment without changing dev behaviour.
# shellcheck disable=SC2086
if ! API_REPLICAS="${API_REPLICAS:-1}" WORKER_REPLICAS="${WORKER_REPLICAS:-1}" \
  docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate --remove-orphans "${SERVICES[@]}"; then
  sec::err "Compose startup failed. Container status and recent dependency logs follow."
  docker compose "${COMPOSE_ARGS[@]}" ps -a || true
  docker compose "${COMPOSE_ARGS[@]}" logs --tail=100 \
    postgres redis-cache redis-queue minio minio-init mailpit migration "${SERVICES[@]}" || true
  exit 1
fi

echo ""
sec::log "Container status:"
# shellcheck disable=SC2086
docker compose "${COMPOSE_ARGS[@]}" ps

# Smoke test only meaningful when api is part of this build run.
if printf '%s\n' "${SERVICES[@]}" | grep -qx api; then
  echo ""
  sec::log "Smoke test: GET /api/v1/health/live"
  # Use 127.0.0.1: on Windows / dual-stack hosts `localhost` resolves to ::1 first
  # and curl hangs if the listener is bound only on IPv4. -m caps each attempt; we
  # retry for ~30s while Nest finishes wiring up its providers.
  SMOKE_URL="http://127.0.0.1:${API_PORT:-3000}/api/v1/health/live"
  SMOKE_OUT=""
  for _ in $(seq 1 15); do
    if SMOKE_OUT=$(curl -sf -m 2 "$SMOKE_URL" 2>/dev/null); then
      break
    fi
    sleep 2
  done
  if [[ -n "$SMOKE_OUT" ]]; then
    echo "$SMOKE_OUT" | python3 -m json.tool 2>/dev/null || echo "$SMOKE_OUT"
    sec::ok "API health check passed"
  else
    sec::err "Smoke test: API did not respond at $SMOKE_URL within 30s"
    docker compose "${COMPOSE_ARGS[@]}" ps -a api worker scheduler migration || true
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=100 api worker scheduler migration || true
    exit 1
  fi
fi

# Compose tags as `<project>-<service>:latest`; project name defaults to the
# directory name unless COMPOSE_PROJECT_NAME is set. Used by the build report below.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"

# --- Build report -----------------------------------------------------------
echo ""
sec::log "Build report"
printf 'Time:  %d:%02d  (%ds total for: %s)\n' \
  $((BUILD_ELAPSED / 60)) $((BUILD_ELAPSED % 60)) \
  "$BUILD_ELAPSED" "${SERVICES[*]}"
echo ""
printf 'Image sizes:\n'
printf '  %-14s %10s\n' 'service' 'size'
printf '  %-14s %10s\n' '-------' '----'
for svc in "${SERVICES[@]}"; do
  img="${COMPOSE_PROJECT_NAME}-${svc}:latest"
  size_bytes=$(docker image inspect "$img" --format '{{.Size}}' 2>/dev/null || echo "")
  if [[ -z "$size_bytes" ]]; then
    printf '  %-14s %10s\n' "$svc" '(missing)'
    continue
  fi
  size_mb=$(awk -v b="$size_bytes" 'BEGIN { printf "%.0f", b / 1024 / 1024 }')
  printf '  %-14s %7s MB\n' "$svc" "$size_mb"
done

echo ""
sec::ok "API docs:   http://localhost:3000/docs        (Scalar UI, dev only)"
sec::ok "OpenAPI:    http://localhost:3000/docs-json   (raw spec for Orval / Postman)"
sec::ok "Auth docs:  http://localhost:3000/api/auth/reference"
if [[ $WITH_OBS -eq 1 ]]; then
  sec::ok "Grafana:    http://localhost:3001  (admin / admin)"
  sec::ok "Jaeger:     http://localhost:16686"
  sec::ok "Prometheus: http://localhost:9090"
fi
sec::ok "Done."
