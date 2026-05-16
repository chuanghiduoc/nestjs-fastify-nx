#!/usr/bin/env bash
# Stop and remove the dev (or prod) Docker Compose stack.
#
# Usage:
#   ./scripts/teardown.sh                 # stops dev stack, removes volumes
#   ./scripts/teardown.sh --keep-volumes  # stops dev stack, keeps volumes
#   ./scripts/teardown.sh --prod          # stops prod stack, removes volumes
#   ./scripts/teardown.sh --prod --keep-volumes
#   ./scripts/teardown.sh --help
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source shared color helpers from security lib.
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"

cd "${REPO_ROOT}"

PROD=0
KEEP_VOLUMES=0

for arg in "$@"; do
  case "$arg" in
    --prod)         PROD=1 ;;
    --keep-volumes) KEEP_VOLUMES=1 ;;
    --help|-h)
      echo "Usage: ./scripts/teardown.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --prod          Target prod compose (compose.prod.yml) instead of dev"
      echo "  --keep-volumes  Skip -v flag — named volumes are preserved"
      echo "  --help          Show this help text"
      echo ""
      echo "Examples:"
      echo "  ./scripts/teardown.sh                  # dev stack, remove volumes"
      echo "  ./scripts/teardown.sh --keep-volumes   # dev stack, keep volumes"
      echo "  ./scripts/teardown.sh --prod           # prod stack, remove volumes"
      exit 0
      ;;
    *)
      sec::err "Unknown option: $arg  (try --help)"
      exit 1
      ;;
  esac
done

if [[ $PROD -eq 1 ]]; then
  OVERLAY="docker/compose.prod.yml"
  STACK_LABEL="prod"
else
  OVERLAY="docker/compose.dev.yml"
  STACK_LABEL="dev"
fi

DOWN_FLAGS=(--remove-orphans)
if [[ $KEEP_VOLUMES -eq 0 ]]; then
  DOWN_FLAGS+=(-v)
  VOLUME_NOTE="(volumes will be deleted)"
else
  VOLUME_NOTE="(volumes preserved)"
fi

sec::log "Tearing down ${STACK_LABEL} stack ${VOLUME_NOTE}"

ENV_FILE_ARGS=()
if [[ -f .env ]]; then
  ENV_FILE_ARGS=(--env-file .env)
fi

docker compose "${ENV_FILE_ARGS[@]}" \
  -f docker/compose.yml \
  -f "${OVERLAY}" \
  down "${DOWN_FLAGS[@]}"

sec::ok "Stack stopped and cleaned up."
