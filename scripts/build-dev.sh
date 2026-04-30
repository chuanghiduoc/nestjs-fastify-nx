#!/usr/bin/env bash
# Build all services in development mode using docker compose
set -euo pipefail

# Always run from project root regardless of where the script is called from
cd "$(dirname "$0")/.."

# --env-file .env is required because the compose files live under docker/ —
# without it compose looks for `docker/.env` (not present) and every
# `${VAR:-default}` interpolation falls back to its default. The same .env is
# also injected into containers via `env_file: ../.env`; the CLI flag covers
# the host-side substitution that env_file cannot.
COMPOSE_BASE="--env-file .env -f docker/compose.yml -f docker/compose.dev.yml"

echo "==> Building dev images (api, worker, scheduler)..."
docker compose $COMPOSE_BASE build --no-cache api worker scheduler

echo ""
echo "==> Starting / recreating all services..."
docker compose $COMPOSE_BASE up -d --force-recreate

echo ""
echo "==> Waiting 10s for services to start..."
sleep 10

echo ""
echo "==> Container status:"
docker compose $COMPOSE_BASE ps

echo ""
echo "==> Smoke test: GET /api/v1/health/live"
curl -sf http://localhost:3000/api/v1/health/live | python3 -m json.tool 2>/dev/null \
  || curl -s http://localhost:3000/api/v1/health/live

# Dev images carry devDeps so unfixed-and-noisy CVEs are normal — gate is OFF
# (TRIVY_EXIT_CODE=0). Awareness, not blocking. Set TRIVY_SCAN=0 to skip.
# Compose tags as `<project>-<service>:latest`; project name defaults to the
# directory name unless COMPOSE_PROJECT_NAME is set.
if [[ "${TRIVY_SCAN:-1}" = "1" ]] && command -v docker >/dev/null 2>&1; then
  COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"
  echo ""
  echo "==> Image vulnerability scan (Trivy, warn-only on dev images)"
  for svc in api worker scheduler; do
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

echo ""
echo "==> Swagger UI available at: http://localhost:3000/api/docs"
echo "Done."
