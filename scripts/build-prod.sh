#!/usr/bin/env bash
# Build all production Docker images (multi-stage, target=production) and tag
# them with the same `${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/<app>:${IMAGE_TAG}`
# scheme that docker/compose.prod.yml expects, so a local prod-smoke can run
# directly via:
#
#   ./scripts/build-prod.sh
#   docker compose --env-file .env -f docker/compose.yml -f docker/compose.prod.yml up -d
#
# IMAGE_REGISTRY / IMAGE_NAMESPACE / IMAGE_TAG are read from .env (sourced
# below) or from the calling shell. If IMAGE_NAMESPACE is empty a 'local'
# fallback is used so the script always completes — set it before pushing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared color helpers.
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/build-prod.sh [--help]"
  echo ""
  echo "Builds production images for api, worker, scheduler, and migration, then"
  echo "boots the full stack so /docs, /health, and the worker queues are reachable."
  echo "Reads IMAGE_REGISTRY / IMAGE_NAMESPACE / IMAGE_TAG from .env or environment."
  echo ""
  echo "Auto-detection (after build, before up):"
  echo "  STORAGE_ENDPOINT      empty / localhost / minio  -> bundle local MinIO"
  echo "  MAIL_HOST             empty / localhost / mailpit -> bundle local Mailpit"
  echo ""
  echo "Env flags:"
  echo "  NO_UP=1             Skip the auto-up step (build only)"
  echo "  IMAGE_NAMESPACE     Required for registry push; defaults to 'local' for smoke"
  echo ""
  echo "Security scanning + SBOM/provenance attestations are NOT run here — they"
  echo "live in CI (.github/workflows/release.yml: Trivy, Cosign, SBOM, provenance)."
  echo "Local builds stay fast; run scripts/security/*.sh manually for local parity."
  echo ""
  echo "Examples:"
  echo "  ./scripts/build-prod.sh"
  echo "  NO_UP=1 ./scripts/build-prod.sh             # only build, do not start stack"
  exit 0
fi

cd "$(sec::repo_root)"

sec::source_env IMAGE_REGISTRY IMAGE_NAMESPACE IMAGE_TAG STORAGE_ENDPOINT MAIL_HOST \
  API_PORT MINIO_PORT MINIO_CONSOLE_PORT MAILPIT_HTTP_PORT COMPOSE_PROJECT_NAME SWARM_STACK_NAME
sec::source_env PROD_STARTUP_TIMEOUT_SECONDS

IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

if [[ -z "$IMAGE_NAMESPACE" ]]; then
  sec::warn "IMAGE_NAMESPACE is not set — falling back to 'local' for smoke test."
  sec::warn "Set IMAGE_NAMESPACE in .env (e.g. IMAGE_NAMESPACE=your-org/your-repo)"
  sec::warn "before pushing to a registry or running docker/compose.prod.yml."
  IMAGE_NAMESPACE="local"
fi

export IMAGE_REGISTRY IMAGE_NAMESPACE IMAGE_TAG
PREFIX="${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}"

sec::log "Building production images under ${PREFIX}/*:${IMAGE_TAG}"

# SBOM + provenance attestations are produced by CI (release.yml) on the pushed
# image, not here — local builds only `--load` into the daemon for smoke tests,
# where attestations add minutes (syft filesystem indexing) for no benefit.
# buildx still emits a default (min) provenance manifest unless told otherwise,
# so disable default attestations explicitly — they double the export phase.
export BUILDX_NO_DEFAULT_ATTESTATIONS=1


# api/worker/scheduler/migration all share a single Dockerfile so BuildKit
# receives one Bake graph, so the shared workspace/build stage executes once.
docker buildx bake -f docker-bake.hcl production --load

echo ""
sec::ok "All production images built:"
printf '  %-14s %10s\n' 'service' 'size'
printf '  %-14s %10s\n' '-------' '----'
for svc in api worker scheduler migration; do
  image="${PREFIX}/${svc}:${IMAGE_TAG}"
  size_bytes=$(docker image inspect "$image" --format '{{.Size}}')
  size_mb=$(awk -v b="$size_bytes" 'BEGIN { printf "%.0f", b / 1024 / 1024 }')
  printf '  %-14s %7s MB\n' "$svc" "$size_mb"
done

# Image vulnerability scanning is the CI gate's job (release.yml runs Trivy per
# app and uploads SARIF to GitHub Security). Run ./scripts/security/scan-images.sh
# manually if you need a local pre-push check.

if [[ "${NO_UP:-0}" = "1" ]]; then
  echo ""
  sec::ok "Build complete. NO_UP=1 — skipping auto-boot."
  sec::ok "Bring the stack up manually:"
  echo "    docker compose --env-file .env -f docker/compose.yml -f docker/compose.prod.yml up -d"
  exit 0
fi

# ---------------------------------------------------------------------------
# Tear down anything we may have left running before booting the fresh stack.
# Covers: previous compose run, previous swarm-local-test deploy, dev stack.
# Volumes are kept by default so iterative builds preserve user/queue data.
# ---------------------------------------------------------------------------
echo ""
sec::log "Tearing down any previous local stack"

COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-nestjs-fastify-nx}"

# 1. Swarm leftover (swarm-local-test.sh uses SWARM_STACK_NAME, default `app`).
SWARM_STACK_NAME="${SWARM_STACK_NAME:-app}"
if docker stack ls --format '{{.Name}}' 2>/dev/null | grep -Fxq "$SWARM_STACK_NAME"; then
  docker stack rm "$SWARM_STACK_NAME" >/dev/null 2>&1 || true
  # Swarm removal is async — wait a beat for services to fully unwind so the
  # compose up below doesn't race on overlapping networks.
  sleep 5
fi

# 2. Compose stacks (dev + prod overlays). `down --remove-orphans` clears
#    services from previous overlay combos. Volumes preserved.
for OVERLAY in docker/compose.dev.yml docker/compose.prod.yml; do
  docker compose -p "$COMPOSE_PROJECT" \
    -f docker/compose.yml \
    -f "$OVERLAY" \
    down --remove-orphans >/dev/null 2>&1 || true
done

# ---------------------------------------------------------------------------
# Detect whether the operator has wired external S3 / SMTP. If not, fold in
# the swarm-local-test overlay which bundles MinIO + Mailpit + valid prod-env
# overrides so the strict NODE_ENV=production validator passes.
# ---------------------------------------------------------------------------
echo ""
sec::log "Preparing prod stack"

# Resolve the relevant env keys without unsetting them — read fresh from the
# loaded .env, fall back to current shell, ignore everything else.
STORAGE_HINT="${STORAGE_ENDPOINT:-}"
MAIL_HINT="${MAIL_HOST:-}"

case "${STORAGE_HINT}" in
  ''|*localhost*|*127.0.0.1*|*minio*) USE_LOCAL_S3=1 ;;
  *)                                   USE_LOCAL_S3=0 ;;
esac

case "${MAIL_HINT}" in
  ''|localhost|mailpit) USE_LOCAL_SMTP=1 ;;
  *)                    USE_LOCAL_SMTP=0 ;;
esac

COMPOSE_FILES=(-f docker/compose.yml -f docker/compose.prod.yml)
if [[ $USE_LOCAL_S3 -eq 1 ]] || [[ $USE_LOCAL_SMTP -eq 1 ]]; then
  COMPOSE_FILES+=(-f docker/compose.swarm-local-test.yml)
  if [[ $USE_LOCAL_S3 -eq 1 ]]; then
    sec::log "STORAGE_ENDPOINT not set to external S3 -> bundling MinIO"
  fi
  if [[ $USE_LOCAL_SMTP -eq 1 ]]; then
    sec::log "MAIL_HOST not set to external SMTP -> bundling Mailpit"
  fi
else
  sec::log "External S3 + SMTP detected — bundled MinIO / Mailpit skipped"
fi

echo ""
sec::log "Booting prod stack"
if ! docker compose -p "$COMPOSE_PROJECT" --env-file .env "${COMPOSE_FILES[@]}" \
  up -d --remove-orphans --wait --wait-timeout "${PROD_STARTUP_TIMEOUT_SECONDS:-120}"; then
  sec::err "Production stack did not become healthy"
  docker compose -p "$COMPOSE_PROJECT" --env-file .env "${COMPOSE_FILES[@]}" ps -a || true
  docker compose -p "$COMPOSE_PROJECT" --env-file .env "${COMPOSE_FILES[@]}" logs \
    --tail=100 api worker scheduler migration minio-init || true
  exit 1
fi

API_BASE="http://127.0.0.1:${API_PORT:-3000}"
LIVE_CODE=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code}' \
  "${API_BASE}/api/v1/health/live" || true)
READY_CODE=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code}' \
  "${API_BASE}/api/v1/health/ready" || true)
DOCS_CODE=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code}' \
  "${API_BASE}/docs-json" || true)
if [[ "$LIVE_CODE" != "200" || "$READY_CODE" != "200" || "$DOCS_CODE" != "404" ]]; then
  sec::err "Production smoke failed (live=${LIVE_CODE}, ready=${READY_CODE}, docs=${DOCS_CODE})"
  docker compose -p "$COMPOSE_PROJECT" --env-file .env "${COMPOSE_FILES[@]}" logs \
    --tail=100 api worker scheduler migration || true
  exit 1
fi
sec::ok "Production smoke passed (live=200, ready=200, docs hidden=404)"

echo ""
sec::ok "Stack up. Useful endpoints:"
echo "    API root:    http://localhost:${API_PORT:-3000}/api/v1"
echo "    Healthcheck: http://localhost:${API_PORT:-3000}/api/v1/health"
echo "    OpenAPI:     http://localhost:${API_PORT:-3000}/docs-json  (gated by NODE_ENV — prod hides it)"
echo "    Bull Board:  http://localhost:${API_PORT:-3000}/api/admin/queues"
if [[ $USE_LOCAL_S3 -eq 1 ]]; then
  echo "    MinIO API:   http://localhost:${MINIO_PORT:-9000}"
  echo "    MinIO UI:    http://localhost:${MINIO_CONSOLE_PORT:-9001}  (user: localtest-access-key)"
fi
if [[ $USE_LOCAL_SMTP -eq 1 ]]; then
  echo "    Mailpit UI:  http://localhost:${MAILPIT_HTTP_PORT:-8025}"
fi
echo ""
sec::ok "Tear down:  ./scripts/teardown.sh --prod"
sec::ok "Done."
