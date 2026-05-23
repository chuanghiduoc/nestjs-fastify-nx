#!/usr/bin/env bash
# Boot the prod stack in single-node Swarm for prod-parity testing.
# Validator placeholders live in docker/compose.swarm-local-test.yml — only
# variables consumed by ${} substitution in compose YAML are exported here.
#
# Usage:
#   ./scripts/swarm-local-test.sh           # default API_REPLICAS=2 WORKER_REPLICAS=2
#   ./scripts/swarm-local-test.sh up
#   ./scripts/swarm-local-test.sh down
#   API_REPLICAS=5 ./scripts/swarm-local-test.sh up
set -euo pipefail

STACK=app
ACTION="${1:-up}"

case "$ACTION" in
  down) docker stack rm "$STACK"; exit 0 ;;
  up) ;;
  *) echo "usage: $0 [up|down]" >&2; exit 1 ;;
esac

export IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
export IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-local}"
export IMAGE_TAG="${IMAGE_TAG:-latest}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nestjs-fastify-nx}"
export API_REPLICAS="${API_REPLICAS:-2}"
export WORKER_REPLICAS="${WORKER_REPLICAS:-2}"

# Docker 29.x's stack deploy parser doesn't resolve the `!override`/`!reset` tags
# our compose.swarm.yml relies on — produces `depends_on must be a list` on worker/scheduler.
# Workaround: let `docker compose config` resolve the merge first, then pipe the
# canonical YAML into stack deploy. `--resolve-image=never` keeps the local image store.
# Compose → Swarm canonicalisation pipeline:
#   1. `docker compose config` resolves overlays + interpolation
#   2. swarmify-compose.mjs flattens depends_on map → list (Swarm only takes short-form;
#      compose drops the `!override` tag during merge so we re-canonicalise here)
#   3. sed re-quotes cpus (Swarm rejects unquoted numerics) and unquotes
#      published ports (Swarm requires integer ports)
SCRIPT_DIR_SLT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker compose \
  -f docker/compose.yml \
  -f docker/compose.prod.yml \
  -f docker/compose.swarm.yml \
  -f docker/compose.swarm-local-test.yml \
  config \
  | node "${SCRIPT_DIR_SLT}/security/swarmify-compose.mjs" \
  | sed -E "s/^([[:space:]]*cpus:)[[:space:]]+([0-9.]+)[[:space:]]*\$/\1 '\2'/; s/^([[:space:]]*published:)[[:space:]]+\"([0-9]+)\"[[:space:]]*\$/\1 \2/" \
  | docker stack deploy --resolve-image=never -c - "$STACK"
