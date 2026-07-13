#!/usr/bin/env bash
# Gitleaks — secret scan across staged + working tree + git history.
#
# Modes:
#   default        → full repo + history (pre-push / CI)
#   --staged       → only files in `git diff --cached` (pre-commit)
#   --no-git       → filesystem scan ignoring .git (covers untracked dirs CI'd
#                    surface, e.g. node_modules off-repo)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/security/scan-secrets.sh [MODE] [--help]"
  echo ""
  echo "Modes:"
  echo "  (none)      Full repo + git history scan (default)"
  echo "  --staged    Only files in git diff --cached (pre-commit)"
  echo "  --no-git    Filesystem scan ignoring .git"
  echo ""
  echo "Env flags:"
  echo "  GITLEAKS_VERSION   Override image version (default: v8.21.2)"
  echo "  GITLEAKS_CONFIG    Path to custom .gitleaks.toml config"
  exit 0
fi

cd "$(sec::repo_root)"

GITLEAKS_VERSION="${GITLEAKS_VERSION:-v8.21.2}"
GITLEAKS_IMAGE="zricethezav/gitleaks:${GITLEAKS_VERSION}"
MODE="${1:-full}"

case "$MODE" in
  --staged) ARGS=(protect --staged --redact --verbose) ;;
  --no-git) ARGS=(detect --no-git --redact --verbose) ;;
  full)     ARGS=(detect --redact --verbose) ;;
  *) sec::err "Unknown mode: $MODE (try --help)"; exit 1 ;;
esac

CONFIG_ARGS=()
if [[ -n "${GITLEAKS_CONFIG:-}" ]]; then
  CONFIG_ARGS=(--config "$GITLEAKS_CONFIG")
fi

# Gitleaks runs inside a container. Without a reachable Docker daemon the scan
# cannot run, so skip rather than block the commit — pre-push full scan and the
# CI secret-scan job still gate the diff before it reaches the remote.
if ! docker info >/dev/null 2>&1; then
  sec::warn "Docker unavailable — skipping local Gitleaks scan (pre-push + CI still gate)."
  exit 0
fi

sec::log "Gitleaks ${GITLEAKS_VERSION} (mode: ${MODE})"
# Read-only mount; gitleaks never writes back.
sec::docker_run --rm \
  -v "$(pwd):/repo:ro" \
  -w /repo \
  "${GITLEAKS_IMAGE}" "${ARGS[@]}" \
  --source /repo \
  "${CONFIG_ARGS[@]+"${CONFIG_ARGS[@]}"}"
