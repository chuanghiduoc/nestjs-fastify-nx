#!/usr/bin/env bash
# Semgrep — SAST scan with curated rule packs for this stack.
#
# Default severity gate: ERROR (highest). Pass `--audit` to see WARNING/INFO too.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/security/scan-sast.sh [MODE] [--help]"
  echo ""
  echo "Modes:"
  echo "  (none)    Gate on ERROR-level findings (default, CI parity)"
  echo "  --audit   Show all severities without failing"
  echo ""
  echo "Env flags:"
  echo "  SEMGREP_VERSION   Override image version (default: 1.99.0)"
  exit 0
fi

cd "$(sec::repo_root)"

SEMGREP_VERSION="${SEMGREP_VERSION:-1.99.0}"
SEMGREP_IMAGE="semgrep/semgrep:${SEMGREP_VERSION}"
MODE="${1:-error}"

# Rule packs scoped to the repo's actual surface — anything outside this list
# is noise we'd ignore anyway. p/secrets backstops gitleaks via AST checks.
RULES=(
  --config p/typescript
  --config p/nodejs
  --config p/javascript
  --config p/owasp-top-ten
  --config p/jwt
  --config p/sql-injection
  --config p/xss
  --config p/command-injection
  --config p/secrets
  --config p/dockerfile
  --config p/ci
)

case "$MODE" in
  --audit)
    GATE=()
    sec::log "Semgrep ${SEMGREP_VERSION} (audit — all severities)"
    ;;
  *)
    # `--error` exits non-zero on ERROR-level findings; others stay informational.
    GATE=(--error)
    sec::log "Semgrep ${SEMGREP_VERSION} (gate: ERROR)"
    ;;
esac

sec::docker_run --rm \
  -v "$(pwd):/src:ro" \
  -w /src \
  "${SEMGREP_IMAGE}" semgrep scan \
  "${RULES[@]}" \
  "${GATE[@]+"${GATE[@]}"}" \
  --metrics=off \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=coverage \
  --exclude=.nx
