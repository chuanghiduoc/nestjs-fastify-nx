#!/usr/bin/env bash
# Remove a folder module from libs/modules/src and drop its exports-map entry.
# Usage: pnpm rm:module <name>   (name = folder under libs/modules/src)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"
cd "$(sec::repo_root)"

NAME="${1:-}"
if [[ -z "$NAME" || "$NAME" == "--help" || "$NAME" == "-h" ]]; then
  sec::err "Usage: pnpm rm:module <name>   (name = folder under libs/modules/src)"
  exit 1
fi
if [[ ! "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]; then
  sec::err "'$NAME' is not a valid folder name (kebab-case)"
  exit 1
fi

FOLDER="libs/modules/src/$NAME"
if [[ ! -d "$FOLDER" ]]; then
  sec::err "Folder '$FOLDER' does not exist"
  exit 1
fi

sec::log "Removing '$FOLDER'"
rm -rf "$FOLDER"

node - "$NAME" <<'EOF'
const fs = require('fs');
const name = process.argv[2];
const path = 'libs/modules/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
if (pkg.exports && pkg.exports[`./${name}`]) {
  delete pkg.exports[`./${name}`];
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}
EOF

sec::log "Dropped the './$NAME' exports-map entry"

LEFTOVERS="$(grep -rn "@nestjs-fastify-nx/modules/$NAME" apps libs --include='*.ts' --include='*.json' || true)"
if [[ -n "$LEFTOVERS" ]]; then
  sec::warn "Leftover references to clean up:"
  echo "$LEFTOVERS"
else
  sec::ok "No leftover references"
fi

sec::ok "Removed. Verify: pnpm nx affected -t lint typecheck test --base=origin/main"
