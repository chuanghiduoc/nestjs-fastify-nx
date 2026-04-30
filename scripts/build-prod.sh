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
# below) or from the calling shell. IMAGE_NAMESPACE must be set — leaving
# it empty would produce malformed tags like `ghcr.io//api:latest`.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

if [[ -z "$IMAGE_NAMESPACE" ]]; then
  echo "ERROR: IMAGE_NAMESPACE is empty." >&2
  echo "Set it in .env (e.g. IMAGE_NAMESPACE=your-org/your-repo) — the same" >&2
  echo "value docker/compose.prod.yml uses to resolve image references." >&2
  exit 1
fi

PREFIX="${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}"

echo "==> Building production images under ${PREFIX}/*:${IMAGE_TAG}"

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

build api       apps/api/Dockerfile        production
build worker    apps/worker/Dockerfile     production
build scheduler apps/scheduler/Dockerfile  production
build migration apps/migration/Dockerfile

echo ""
echo "==> All production images built:"
docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' \
  | grep -E "^${PREFIX}/(api|worker|scheduler|migration):${IMAGE_TAG}\b" || true

# Image scan via shared helper. Local prod-build defaults to gate ON (CI parity);
# pass TRIVY_EXIT_CODE=0 to demote to warn-only, TRIVY_SCAN=0 to skip entirely.
if [[ "${TRIVY_SCAN:-1}" = "1" ]]; then
  echo ""
  echo "==> Image vulnerability scan (Trivy)"
  ./scripts/security/scan-images.sh || {
    echo ""
    echo "Trivy gate failed. To inspect:  ./scripts/security/scan-images.sh <app>"
    echo "To bypass for a quick local smoke:  TRIVY_EXIT_CODE=0 ./scripts/build-prod.sh"
    exit 1
  }
fi

echo ""
echo "==> Bring the stack up with the same image refs:"
echo "    docker compose --env-file .env -f docker/compose.yml -f docker/compose.prod.yml up -d"
echo "Done."
