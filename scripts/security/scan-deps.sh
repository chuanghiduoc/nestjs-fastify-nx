#!/usr/bin/env bash
# OSV-Scanner — Google's vuln scanner over OSV.dev DB.
#
# Reads pnpm-lock.yaml directly so transitive resolutions match what's actually
# installed. Complements `pnpm audit` (npm registry advisories) and Trivy
# (image-level OS + lang) by covering OSV.dev's broader feed.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/security/scan-deps.sh [--help]"
  echo ""
  echo "Scans pnpm-lock.yaml against the OSV.dev vulnerability database."
  echo ""
  echo "Env flags:"
  echo "  OSV_VERSION   Override image version (default: v2.0.2)"
  exit 0
fi

cd "$(sec::repo_root)"

OSV_VERSION="${OSV_VERSION:-v2.0.2}"
OSV_IMAGE="ghcr.io/google/osv-scanner:${OSV_VERSION}"

sec::log "OSV-Scanner ${OSV_VERSION} (lockfile + workspace)"
# scan source mode resolves all manifests recursively; --recursive walks subdirs.
sec::docker_run --rm \
  -v "$(pwd):/src:ro" \
  -w /src \
  "${OSV_IMAGE}" scan source \
  --recursive \
  --lockfile=/src/pnpm-lock.yaml
