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
  echo "  TRIVY_SCAN=0        Skip Trivy gate"
  echo "  TRIVY_EXIT_CODE=0   Demote Trivy failures to warnings"
  echo "  ATTEST_SKIP=1       Skip SBOM + provenance attestations (faster local iteration)"
  echo "  NO_UP=1             Skip the auto-up step (build only)"
  echo "  IMAGE_NAMESPACE     Required for registry push; defaults to 'local' for smoke"
  echo ""
  echo "Examples:"
  echo "  ./scripts/build-prod.sh"
  echo "  TRIVY_EXIT_CODE=0 ./scripts/build-prod.sh   # warn-only scan"
  echo "  TRIVY_SCAN=0 ./scripts/build-prod.sh        # skip scan"
  echo "  NO_UP=1 ./scripts/build-prod.sh             # only build, do not start stack"
  exit 0
fi

cd "$(sec::repo_root)"

sec::source_env

IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

if [[ -z "$IMAGE_NAMESPACE" ]]; then
  sec::warn "IMAGE_NAMESPACE is not set — falling back to 'local' for smoke test."
  sec::warn "Set IMAGE_NAMESPACE in .env (e.g. IMAGE_NAMESPACE=your-org/your-repo)"
  sec::warn "before pushing to a registry or running docker/compose.prod.yml."
  IMAGE_NAMESPACE="local"
fi

PREFIX="${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}"

sec::log "Building production images under ${PREFIX}/*:${IMAGE_TAG}"

# SBOM + max-mode provenance attestations let Scout/Trivy/registry policy engines
# reason about the image without re-indexing the filesystem. Set ATTEST_SKIP=1
# to disable when iterating locally — syft can flake on slow disks.
ATTEST_ARGS=(--sbom=true --provenance=mode=max)
if [[ "${ATTEST_SKIP:-0}" = "1" ]]; then
  ATTEST_ARGS=()
  sec::warn "Attestations disabled (ATTEST_SKIP=1)"
fi

build() {
  local app="$1" dockerfile="$2" target="${3:-}"
  local target_args=()
  [[ -n "$target" ]] && target_args=(--target "$target")
  echo ""
  echo "--- ${app} ---"
  docker buildx build -f "$dockerfile" "${target_args[@]}" "${ATTEST_ARGS[@]}" \
    --load -t "${PREFIX}/${app}:${IMAGE_TAG}" .
}

# api/worker/scheduler/migration all share a single Dockerfile so BuildKit
# reuses the `workspace` stage (install + COPY + prisma generate + nx sync)
# across all four images — one install round-trip instead of two.
build api       Dockerfile api
build worker    Dockerfile worker
build scheduler Dockerfile scheduler
build migration Dockerfile migration

echo ""
sec::ok "All production images built:"
docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' \
  | grep -E "^${PREFIX}/(api|worker|scheduler|migration):${IMAGE_TAG}\b" || true

# Image scan via shared helper. Local prod-build defaults to gate ON (CI parity);
# pass TRIVY_EXIT_CODE=0 to demote to warn-only, TRIVY_SCAN=0 to skip entirely.
if [[ "${TRIVY_SCAN:-1}" = "1" ]]; then
  echo ""
  sec::log "Image vulnerability scan (Trivy)"
  ./scripts/security/scan-images.sh || {
    echo ""
    sec::err "Trivy gate failed. To inspect:  ./scripts/security/scan-images.sh <app>"
    sec::err "To bypass for a quick local smoke:  TRIVY_EXIT_CODE=0 ./scripts/build-prod.sh"
    exit 1
  }
fi

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

# 1. Swarm leftover (swarm-local-test.sh up creates `app_*` services).
if docker stack ls --format '{{.Name}}' 2>/dev/null | grep -q '^app$'; then
  docker stack rm app >/dev/null 2>&1 || true
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
docker compose -p "$COMPOSE_PROJECT" --env-file .env "${COMPOSE_FILES[@]}" \
  up -d --remove-orphans

echo ""
sec::ok "Stack up. Useful endpoints:"
echo "    API root:    http://localhost:${API_PORT:-3000}/api/v1"
echo "    Healthcheck: http://localhost:${API_PORT:-3000}/api/v1/health"
echo "    OpenAPI:     http://localhost:${API_PORT:-3000}/docs-json  (gated by NODE_ENV — prod hides it)"
echo "    Bull Board:  http://localhost:${API_PORT:-3000}/api/admin/queues"
if [[ $USE_LOCAL_S3 -eq 1 ]]; then
  echo "    MinIO UI:    http://localhost:9001  (user: localtest-access-key)"
fi
if [[ $USE_LOCAL_SMTP -eq 1 ]]; then
  echo "    Mailpit UI:  http://localhost:${MAILPIT_HTTP_PORT:-8025}"
fi
echo ""
sec::ok "Tear down:  ./scripts/teardown.sh --prod"
sec::ok "Done."
