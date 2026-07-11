#!/usr/bin/env bash
# Scaffold a DDD bounded context or composition lib via the workspace generator,
# then sync tsconfig project references. Invoked through pnpm:
#   pnpm gen:module <name>        -> libs/modules/<name>
#   pnpm gen:composition <name>   -> libs/composition/<name>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"
cd "$(sec::repo_root)"

DIRECTORY="${1:-}"
NAME="${2:-}"
if [[ -z "$DIRECTORY" || -z "$NAME" ]]; then
  sec::err "Usage: pnpm gen:module <name>   (or)   pnpm gen:composition <name>"
  exit 1
fi

sec::log "Scaffolding '${NAME}' under libs/${DIRECTORY}/"
pnpm exec nx g @nestjs-fastify-nx/tools-generators:module --name="$NAME" --directory="$DIRECTORY"
pnpm exec nx sync
sec::ok "Done. If the Nx daemon doesn't see it yet, run: pnpm nx reset"
