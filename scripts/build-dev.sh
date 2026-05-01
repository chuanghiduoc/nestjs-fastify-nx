#!/usr/bin/env bash
# Build all services in development mode using docker compose.
#
# Usage:
#   ./scripts/build-dev.sh                  # build api + worker + scheduler
#   ./scripts/build-dev.sh api              # build only api
#   ./scripts/build-dev.sh api worker       # build only api + worker
#
# Env flags:
#   NO_CACHE=1     full clean rebuild (default: incremental)
#   TRIVY_SCAN=0   skip vulnerability scan
set -euo pipefail

# Always run from project root regardless of where the script is called from
cd "$(dirname "$0")/.."

DEFAULT_SERVICES=(api worker scheduler)
if [[ $# -gt 0 ]]; then
  SERVICES=("$@")
else
  SERVICES=("${DEFAULT_SERVICES[@]}")
fi

# --env-file .env is required because the compose files live under docker/.
# Without it compose looks for `docker/.env` (not present) and every
# `${VAR:-default}` interpolation falls back to its default. The same .env
# is also injected into containers via `env_file: ../.env`; the CLI flag
# covers the host-side substitution that env_file cannot.
COMPOSE_BASE="--env-file .env -f docker/compose.yml -f docker/compose.dev.yml"

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

echo "==> Building dev images: ${SERVICES[*]}"
BUILD_START=$(date +%s)
docker compose $COMPOSE_BASE build "${BUILD_FLAGS[@]}" "${SERVICES[@]}"
BUILD_END=$(date +%s)
BUILD_ELAPSED=$((BUILD_END - BUILD_START))

echo ""
echo "==> Starting / recreating: ${SERVICES[*]}"
# `up -d <svc>` brings up listed services plus their depends_on chain
# (postgres, redis-cache, redis-queue, migration). --force-recreate ensures
# the just-rebuilt image actually replaces any running container.
docker compose $COMPOSE_BASE up -d --force-recreate "${SERVICES[@]}"

echo ""
echo "==> Waiting 10s for services to start..."
sleep 10

echo ""
echo "==> Container status:"
docker compose $COMPOSE_BASE ps

# Smoke test only meaningful when api is part of this build run.
if printf '%s\n' "${SERVICES[@]}" | grep -qx api; then
  echo ""
  echo "==> Smoke test: GET /api/v1/health/live"
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
  else
    echo "Smoke test failed: API did not respond at $SMOKE_URL within 30s"
  fi
fi

# Compose tags as `<project>-<service>:latest`; project name defaults to the
# directory name unless COMPOSE_PROJECT_NAME is set. Used by trivy scan and
# the build report below.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"

# Dev images carry devDeps so unfixed-and-noisy CVEs are normal: gate is OFF
# (TRIVY_EXIT_CODE=0). Awareness, not blocking. Set TRIVY_SCAN=0 to skip.
if [[ "${TRIVY_SCAN:-1}" = "1" ]] && command -v docker >/dev/null 2>&1; then
  echo ""
  echo "==> Image vulnerability scan (Trivy, warn-only on dev images)"
  for svc in "${SERVICES[@]}"; do
    img="${COMPOSE_PROJECT_NAME}-${svc}:latest"
    docker image inspect "$img" >/dev/null 2>&1 || continue
    echo ""
    echo "--- trivy: ${svc} ---"
    MSYS_NO_PATHCONV=1 docker run --rm \
      -v //var/run/docker.sock:/var/run/docker.sock \
      -v "${HOME}/.cache/trivy:/root/.cache/trivy" \
      aquasec/trivy:0.62.0 image \
      --severity HIGH,CRITICAL \
      --ignore-unfixed \
      --scanners vuln \
      --exit-code 0 \
      --format table \
      "$img" || true
  done
fi

# --- Build report -----------------------------------------------------------
# Time + image size per service. Prints both raw bytes and human MB so the
# numbers are diffable across runs without parsing docker's locale-specific
# size formatter (e.g. "1.23GB" vs "1,23 GB").
echo ""
echo "==> Build report"
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
echo "==> Swagger UI available at: http://localhost:3000/api/docs"
echo "Done."
