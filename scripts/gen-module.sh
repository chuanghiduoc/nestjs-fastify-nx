#!/usr/bin/env bash
# Scaffold a bounded-context folder inside the modules group, or a composition
# project, then apply the wiring each layout needs. Invoked through pnpm:
#   pnpm gen:module <name>        -> libs/modules/src/<name>/ (folder in the group)
#   pnpm gen:composition <name>   -> libs/composition/<name> (Nx project)
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

sec::log "Scaffolding '${NAME}' (${DIRECTORY})"
pnpm exec nx g @nestjs-fastify-nx/tools-generators:module --name="$NAME" --directory="$DIRECTORY"

if [[ "$DIRECTORY" == "composition" ]]; then
  # The composition scaffold declares sibling libs as `workspace:*`; without an
  # install their node_modules symlinks are missing and the new project fails
  # typecheck/test on unresolved imports.
  pnpm exec nx sync
  sec::log "Linking workspace dependencies (pnpm install)"
  pnpm install
else
  # A folder module resolves through the group package's exports map — no new
  # project, no tsconfig references, nothing to install.
  sec::log "Folder module scaffolded into libs/modules/src/${NAME}/"
  sec::log "Next steps: add the Prisma model + pnpm db:migrate, then register ${NAME}Module in the host app"
fi

sec::ok "Done."
