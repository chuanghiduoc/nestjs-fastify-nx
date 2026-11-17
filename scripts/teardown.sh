#!/usr/bin/env bash
# Stop and remove the dev (or prod) Docker Compose stack.
#
# Usage:
#   ./scripts/teardown.sh                 # stops dev stack, removes volumes
#   ./scripts/teardown.sh --keep-volumes  # stops dev stack, keeps volumes
#   ./scripts/teardown.sh --prod          # stops prod stack, keeps volumes
#   ./scripts/teardown.sh --prod --delete-volumes
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
DELETE_VOLUMES=0

for arg in "$@"; do
  case "$arg" in
    --prod)           PROD=1 ;;
    --keep-volumes)   KEEP_VOLUMES=1 ;;
    --delete-volumes) DELETE_VOLUMES=1 ;;
    --help|-h)
      echo "Usage: ./scripts/teardown.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --prod            Target prod compose (compose.prod.yml) instead of dev"
      echo "  --keep-volumes    Keep the named volumes (default for --prod)"
      echo "  --delete-volumes  Delete the named volumes (default for dev)"
      echo "  --help            Show this help text"
      echo ""
      echo "WARNING: --prod --delete-volumes deletes the production data permanently"
      echo ""
      echo "Examples:"
      echo "  ./scripts/teardown.sh                           # dev stack, remove volumes"
      echo "  ./scripts/teardown.sh --keep-volumes            # dev stack, keep volumes"
      echo "  ./scripts/teardown.sh --prod                    # prod stack, keep volumes"
      echo "  ./scripts/teardown.sh --prod --delete-volumes   # prod stack, remove volumes"
      exit 0
      ;;
    *)
      sec::err "Unknown option: $arg  (try --help)"
      exit 1
      ;;
  esac
done

if [[ $KEEP_VOLUMES -eq 1 && $DELETE_VOLUMES -eq 1 ]]; then
  sec::err "--keep-volumes and --delete-volumes cannot be used together"
  exit 1
fi

if [[ $PROD -eq 1 ]]; then
  OVERLAY="docker/compose.prod.yml"
  STACK_LABEL="prod"
  REMOVE_VOLUMES=$DELETE_VOLUMES
  # compose.prod.yml interpolates ${APP_IMAGE:?}/${MIGRATION_IMAGE:?}; `down` still parses the
  # file, so give the placeholders a value that compose accepts. Nothing is pulled or started.
  export APP_IMAGE="${APP_IMAGE:-teardown-placeholder}"
  export MIGRATION_IMAGE="${MIGRATION_IMAGE:-teardown-placeholder}"
else
  OVERLAY="docker/compose.dev.yml"
  STACK_LABEL="dev"
  REMOVE_VOLUMES=$((1 - KEEP_VOLUMES))
fi

DOWN_FLAGS=(--remove-orphans)
if [[ $REMOVE_VOLUMES -eq 1 ]]; then
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

docker compose "${ENV_FILE_ARGS[@]+"${ENV_FILE_ARGS[@]}"}" \
  -f docker/compose.yml \
  -f "${OVERLAY}" \
  down "${DOWN_FLAGS[@]}"

sec::ok "Stack stopped and cleaned up."
