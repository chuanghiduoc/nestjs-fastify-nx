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

# --resolve-image=never uses the local image store without contacting any registry.
exec docker stack deploy --resolve-image=never \
  -c docker/compose.yml \
  -c docker/compose.prod.yml \
  -c docker/compose.swarm.yml \
  -c docker/compose.swarm-local-test.yml \
  "$STACK"
