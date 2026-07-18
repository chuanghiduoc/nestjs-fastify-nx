#!/usr/bin/env bash
# Trivy — image vuln scan for the four production targets.
#
# Defaults match release.yml's gate so a clean local run implies a clean CI run:
#   --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1
#
# Usage:
#   scan-images.sh                 # all four images
#   scan-images.sh api worker      # subset
#   TRIVY_EXIT_CODE=0 ...          # warn-only (e.g. for build-dev.sh)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/security/scan-images.sh [APP...] [--help]"
  echo ""
  echo "Arguments:"
  echo "  APP...   Image names to scan (default: api worker scheduler migration)"
  echo ""
  echo "Env flags:"
  echo "  TRIVY_VERSION     Override Trivy version (default: 0.62.0)"
  echo "  TRIVY_SEVERITY    Severity filter (default: HIGH,CRITICAL)"
  echo "  TRIVY_EXIT_CODE   1 = gate (default), 0 = warn-only"
  echo "  IMAGE_NAMESPACE   Required — image prefix (e.g. your-org/your-repo)"
  echo "  IMAGE_TAG         Tag to scan (default: latest)"
  exit 0
fi

sec::source_env IMAGE_REGISTRY IMAGE_NAMESPACE IMAGE_TAG
cd "$(sec::repo_root)"

TRIVY_VERSION="${TRIVY_VERSION:-0.62.0}"
TRIVY_IMAGE="aquasec/trivy:${TRIVY_VERSION}"
TRIVY_SEVERITY="${TRIVY_SEVERITY:-HIGH,CRITICAL}"
TRIVY_EXIT_CODE="${TRIVY_EXIT_CODE:-1}"
TRIVY_CACHE="${TRIVY_CACHE:-${HOME}/.cache/trivy}"
mkdir -p "${TRIVY_CACHE}"

PREFIX="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-local}"
TAG="${IMAGE_TAG:-latest}"

if [[ $# -eq 0 ]]; then
  apps=(api worker scheduler migration)
else
  apps=("$@")
fi

failed=()
for app in "${apps[@]}"; do
  sec::log "Trivy ${TRIVY_VERSION} → ${PREFIX}/${app}:${TAG}"
  # `//var/run/...` so MSYS on Git-Bash doesn't translate the path.
  if ! sec::docker_run --rm \
    -v //var/run/docker.sock:/var/run/docker.sock \
    -v "${TRIVY_CACHE}:/root/.cache/trivy" \
    "${TRIVY_IMAGE}" image \
    --severity "${TRIVY_SEVERITY}" \
    --ignore-unfixed \
    --scanners vuln \
    --exit-code "${TRIVY_EXIT_CODE}" \
    --format table \
    "${PREFIX}/${app}:${TAG}"; then
    failed+=("${app}")
  fi
done

if (( ${#failed[@]} > 0 )); then
  sec::err "Trivy gate failed for: ${failed[*]}"
  exit 1
fi
sec::ok "Trivy gate clean (${TRIVY_SEVERITY}, fixable only)"
