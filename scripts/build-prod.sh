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
  echo "Builds production images for api, worker, scheduler, and migration."
  echo "Reads IMAGE_REGISTRY / IMAGE_NAMESPACE / IMAGE_TAG from .env or environment."
  echo ""
  echo "Env flags:"
  echo "  TRIVY_SCAN=0        Skip Trivy gate"
  echo "  TRIVY_EXIT_CODE=0   Demote Trivy failures to warnings"
  echo "  IMAGE_NAMESPACE     Required for registry push; defaults to 'local' for smoke"
  echo ""
  echo "Examples:"
  echo "  ./scripts/build-prod.sh"
  echo "  TRIVY_EXIT_CODE=0 ./scripts/build-prod.sh   # warn-only scan"
  echo "  TRIVY_SCAN=0 ./scripts/build-prod.sh        # skip scan"
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
# reason about the image without re-indexing the filesystem. Buildx ships them
# behind a flag (default: minimal); enable explicitly here.
ATTEST_ARGS=(--sbom=true --provenance=mode=max)

build() {
  local app="$1" dockerfile="$2" target="${3:-}"
  local target_args=()
  [[ -n "$target" ]] && target_args=(--target "$target")
  echo ""
  echo "--- ${app} ---"
  docker buildx build -f "$dockerfile" "${target_args[@]}" "${ATTEST_ARGS[@]}" \
    --load -t "${PREFIX}/${app}:${IMAGE_TAG}" .
}

# api/worker/scheduler share a single Dockerfile so BuildKit reuses the
# `workspace` stage (install + COPY + prisma generate + nx sync) across all
# three. Migration keeps its own Dockerfile — it installs --prod only and
# never copies app source, so there is nothing to share.
build api       Dockerfile                api
build worker    Dockerfile                worker
build scheduler Dockerfile                scheduler
build migration apps/migration/Dockerfile

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

echo ""
sec::ok "Bring the stack up with the same image refs:"
echo "    docker compose --env-file .env -f docker/compose.yml -f docker/compose.prod.yml up -d"
sec::ok "Done."
