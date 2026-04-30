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

cd "$(sec::repo_root)"

GITLEAKS_VERSION="${GITLEAKS_VERSION:-v8.21.2}"
GITLEAKS_IMAGE="zricethezav/gitleaks:${GITLEAKS_VERSION}"
MODE="${1:-full}"

case "$MODE" in
  --staged) ARGS=(protect --staged --redact --verbose) ;;
  --no-git) ARGS=(detect --no-git --redact --verbose) ;;
  full|*)   ARGS=(detect --redact --verbose) ;;
esac

sec::log "Gitleaks ${GITLEAKS_VERSION} (mode: ${MODE})"
# Read-only mount; gitleaks never writes back.
sec::docker_run --rm \
  -v "$(pwd):/repo:ro" \
  -w /repo \
  "${GITLEAKS_IMAGE}" "${ARGS[@]}" \
  --source /repo \
  ${GITLEAKS_CONFIG:+--config "${GITLEAKS_CONFIG}"}
