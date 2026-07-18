#!/usr/bin/env bash
# Run every security scanner the repo ships with.
#
# Order is intentional — fastest + cheapest first, image-based last:
#   1. Gitleaks      (~5s)   secrets in source / history
#   2. OSV-Scanner   (~30s)  dependency CVEs (lockfile)
#   3. Semgrep      (~2m)    SAST rules (TS/Node/OWASP)
#   4. Trivy         (~1m)   image-level CVEs (requires built images)
#
# Trivy is gated on built images existing locally; skipped with a note when
# they're absent (e.g. dev hasn't run build-prod.sh yet).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/security/scan-all.sh [--help]"
  echo ""
  echo "Runs all security scanners in order:"
  echo "  1. Gitleaks   — secret detection"
  echo "  2. OSV        — dependency CVEs"
  echo "  3. Semgrep    — SAST"
  echo "  4. Trivy      — image CVEs (skipped if images not built)"
  echo ""
  echo "Env flags:"
  echo "  IMAGE_NAMESPACE  Required for Trivy (defaults to 'local')"
  echo "  IMAGE_TAG        Image tag (default: latest)"
  exit 0
fi

sec::source_env IMAGE_REGISTRY IMAGE_NAMESPACE IMAGE_TAG

failures=()

run() {
  local name="$1"; shift
  echo
  sec::log "── ${name} ──────────────────────────────────────────"
  if "$@"; then sec::ok "${name} passed"; else sec::err "${name} FAILED"; failures+=("${name}"); fi
}

run "Gitleaks"    "${SCRIPT_DIR}/scan-secrets.sh"
run "OSV-Scanner" "${SCRIPT_DIR}/scan-deps.sh"
run "Semgrep"     "${SCRIPT_DIR}/scan-sast.sh"

PREFIX="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-local}"
TAG="${IMAGE_TAG:-latest}"
if docker image inspect "${PREFIX}/api:${TAG}" >/dev/null 2>&1; then
  run "Trivy" "${SCRIPT_DIR}/scan-images.sh"
else
  sec::warn "Skipping Trivy — ${PREFIX}/api:${TAG} not built locally."
  sec::warn "  Run ./scripts/build-prod.sh first to enable image scans."
fi

echo
if (( ${#failures[@]} > 0 )); then
  sec::err "Failed: ${failures[*]}"
  exit 1
fi
sec::ok "All security scans passed."
