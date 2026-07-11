#!/usr/bin/env bash
# Remove a project (lib or app) and clean up its tsconfig paths, tags, and
# references, then sync project references.
# Usage: pnpm rm:project <project-name>   (list: pnpm nx show projects)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"
cd "$(sec::repo_root)"

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  sec::err "Usage: pnpm rm:project <project-name>   (list: pnpm nx show projects)"
  exit 1
fi

sec::log "Removing project '${NAME}' and its references"
pnpm exec nx g @nx/workspace:remove --projectName="$NAME"
pnpm exec nx sync
sec::ok "Removed. Verify nothing dangles: pnpm nx affected -t typecheck --base=origin/main"
