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
#   NO_CACHE=1     full clean rebuild (default: incremental)
#   TRIVY_SCAN=0   skip vulnerability scan
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared color helpers.
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"

# Always run from project root regardless of where the script is called from.
cd "$(sec::repo_root)"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/build-dev.sh [SERVICE...] [--with-obs] [--help]"
  echo ""
  echo "Arguments:"
  echo "  SERVICE...    Services to build (default: api worker scheduler migration)"
  echo "  --with-obs    Also start the observability stack (Prometheus/Grafana/Jaeger/OTel)"
  echo ""
  echo "Env flags:"
  echo "  NO_CACHE=1    Full clean rebuild"
  echo "  TRIVY_SCAN=0  Skip Trivy vulnerability scan"
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
COMPOSE_BASE="--env-file .env -f docker/compose.yml -f docker/compose.dev.yml"
if [[ $WITH_OBS -eq 1 ]]; then
  COMPOSE_BASE="${COMPOSE_BASE} -f docker/compose.observability.yml"
  sec::log "Observability overlay enabled (Prometheus + Grafana + Jaeger + OTel)"
fi

# --no-cache invalidates every layer (incl. pnpm install) and rebuilds the
# 3 images from scratch. Default to incremental; set NO_CACHE=1 to force.
BUILD_FLAGS=()
if [[ "${NO_CACHE:-0}" = "1" ]]; then
  BUILD_FLAGS+=(--no-cache)
fi

# Skip BuildKit attestations (provenance + sbom) for dev images. Each one
# adds a parallel manifest that has to be exported and unpacked, doubling
# the post-build phase to no benefit on local dev images.
export BUILDX_NO_DEFAULT_ATTESTATIONS=1

sec::log "Building dev images: ${SERVICES[*]}"
BUILD_START=$(date +%s)
# Serial per-service build — parallel buildx fans out tsc + webpack +
# fork-ts-checker per service, which can OOM Docker Desktop's VM.
# Override with BUILD_PARALLEL=1 if the host has enough headroom.
if [[ "${BUILD_PARALLEL:-0}" = "1" ]]; then
  # shellcheck disable=SC2086
  docker compose $COMPOSE_BASE build "${BUILD_FLAGS[@]}" "${SERVICES[@]}"
else
  for svc in "${SERVICES[@]}"; do
    sec::log "  → $svc"
    # shellcheck disable=SC2086
    docker compose $COMPOSE_BASE build "${BUILD_FLAGS[@]}" "$svc"
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
# shellcheck disable=SC2086
docker compose $COMPOSE_BASE rm -sf "${SERVICES[@]}" 2>/dev/null || true
for svc in "${SERVICES[@]}"; do
  # Match all replicas, not just -1, in case API_REPLICAS / WORKER_REPLICAS > 1.
  stale=$(docker ps -aq --filter "name=^${COMPOSE_PROJECT_NAME}-${svc}-[0-9]\+$" 2>/dev/null || true)
  [[ -n "$stale" ]] && docker rm -f $stale 2>/dev/null || true
done

# API_REPLICAS / WORKER_REPLICAS only take effect in Swarm (deploy.replicas is
# ignored by plain `docker compose up`); the passthrough keeps them visible in
# the process environment without changing dev behaviour.
# shellcheck disable=SC2086
API_REPLICAS="${API_REPLICAS:-1}" WORKER_REPLICAS="${WORKER_REPLICAS:-1}" \
  docker compose $COMPOSE_BASE up -d --force-recreate --remove-orphans "${SERVICES[@]}"

echo ""
sec::log "Container status:"
# shellcheck disable=SC2086
docker compose $COMPOSE_BASE ps

# Smoke test only meaningful when api is part of this build run.
if printf '%s\n' "${SERVICES[@]}" | grep -qx api; then
  echo ""
  sec::log "Smoke test: GET /api/v1/health/live"
  # Use 127.0.0.1: on Windows / dual-stack hosts `localhost` resolves to ::1 first
  # and curl hangs if the listener is bound only on IPv4. -m caps each attempt; we
  # retry for ~30s while Nest finishes wiring up its providers.
  SMOKE_URL="http://127.0.0.1:3000/api/v1/health/live"
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
    sec::warn "Smoke test: API did not respond at $SMOKE_URL within 30s"
  fi
fi

# Compose tags as `<project>-<service>:latest`; project name defaults to the
# directory name unless COMPOSE_PROJECT_NAME is set. Used by trivy scan and
# the build report below.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"

# Dev images carry devDeps so unfixed-and-noisy CVEs are normal: gate is OFF
# (TRIVY_EXIT_CODE=0). Awareness, not blocking. Set TRIVY_SCAN=0 to skip.
#
# api/worker/scheduler all derive from the shared `workspace` stage, so they
# share identical base layers. Scanning all three would produce duplicate CVE
# reports for every Node/OS finding. Scan only the first built image and note
# that its findings cover the shared workspace layers for all three services.
if [[ "${TRIVY_SCAN:-1}" = "1" ]] && command -v docker >/dev/null 2>&1; then
  echo ""
  sec::log "Image vulnerability scan (Trivy, warn-only on dev images)"

  # Collect built images in order; stop at the first one that exists.
  SCAN_IMG=""
  SCAN_SVC=""
  for svc in "${SERVICES[@]}"; do
    img="${COMPOSE_PROJECT_NAME}-${svc}:latest"
    if docker image inspect "$img" >/dev/null 2>&1; then
      SCAN_IMG="$img"
      SCAN_SVC="$svc"
      break
    fi
  done

  if [[ -n "$SCAN_IMG" ]]; then
    echo ""
    echo "--- trivy: ${SCAN_SVC} (workspace base layers shared by all services) ---"
    MSYS_NO_PATHCONV=1 docker run --rm \
      -v //var/run/docker.sock:/var/run/docker.sock \
      -v "${HOME}/.cache/trivy:/root/.cache/trivy" \
      aquasec/trivy:0.62.0 image \
      --severity HIGH,CRITICAL \
      --ignore-unfixed \
      --scanners vuln \
      --exit-code 0 \
      --format table \
      "$SCAN_IMG" || true

    # Report skipped services so the output is explicit, not silently absent.
    for svc in "${SERVICES[@]}"; do
      [[ "$svc" == "$SCAN_SVC" ]] && continue
      img="${COMPOSE_PROJECT_NAME}-${svc}:latest"
      docker image inspect "$img" >/dev/null 2>&1 \
        && sec::log "Skipping trivy: ${svc} — same workspace base layers as ${SCAN_SVC}"
    done
  fi
fi

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
sec::ok "Swagger UI: http://localhost:3000/api/docs"
if [[ $WITH_OBS -eq 1 ]]; then
  sec::ok "Grafana:    http://localhost:3001  (admin / admin)"
  sec::ok "Jaeger:     http://localhost:16686"
  sec::ok "Prometheus: http://localhost:9090"
fi
sec::ok "Done."
