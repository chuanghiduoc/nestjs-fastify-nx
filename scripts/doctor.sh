#!/usr/bin/env bash
# Preflight checker — verifies all prerequisites before running the dev stack.
#
# Checks:
#   - Docker daemon running
#   - Docker Compose v2 available
#   - Node.js >= 24
#   - pnpm >= 10
#   - .env file exists
#   - .env drift against .env.example
#   - Ports free: 3000, 5432, 6379, 6380, 9000, 9001, 1025, 8025
#
# Usage:
#   ./scripts/doctor.sh         # run all checks
#   ./scripts/doctor.sh --help  # show help
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source shared color helpers.
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/doctor.sh [--help]"
  echo ""
  echo "Verifies all prerequisites for running the dev stack:"
  echo "  - Docker daemon and Compose v2"
  echo "  - Node.js >= 24, pnpm >= 10"
  echo "  - .env file present with required keys"
  echo "  - Host ports free: 3000 5432 6379 6380 9000 9001 1025 8025"
  echo ""
  echo "Exits 0 if all checks pass, 1 if any check fails."
  exit 0
fi

cd "${REPO_ROOT}"

FAIL=0

pass() { sec::ok  "$1"; }
fail() { sec::err "$1"; FAIL=1; }
warn() { sec::warn "$1"; }
step() { sec::log "$1"; }

# ---------------------------------------------------------------------------
# Helper: version comparison — returns 0 if $1 >= $2 (both as MAJ.MIN.PATCH)
# ---------------------------------------------------------------------------
version_gte() {
  local actual="$1" required="$2"
  # Strip leading 'v' if present.
  actual="${actual#v}"; required="${required#v}"
  # Numeric field sort on MAJ.MIN.PATCH — portable across BSD (macOS) and GNU.
  # `sort -V` is GNU-only and aborts on stock macOS `sort`, which would crash every
  # Node/pnpm version check on a Mac without coreutils installed.
  local lowest
  lowest="$(printf '%s\n%s\n' "$required" "$actual" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)"
  [[ "$lowest" == "$required" ]]
}

# ---------------------------------------------------------------------------
# Helper: check if a TCP port is in use on localhost.
# Uses Node's cross-platform TCP socket first (Node is a checked prerequisite), then native tools.
# Returns 0 if port IS in use, 1 if free.
# ---------------------------------------------------------------------------
port_in_use() {
  local port="$1"
  if command -v node >/dev/null 2>&1; then
    node -e '
      const socket = require("node:net").connect({ host: "127.0.0.1", port: Number(process.argv[1]) });
      const finish = (code) => { socket.destroy(); process.exit(code); };
      socket.setTimeout(750, () => finish(1));
      socket.once("connect", () => finish(0));
      socket.once("error", () => finish(1));
    ' "$port" >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | grep -qE ":${port}\b"
  else
    # Last resort: parse /proc/net/tcp (Linux only, hex ports).
    local hex_port
    hex_port=$(printf '%04X' "$port")
    grep -qi ":${hex_port} " /proc/net/tcp 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# 1. Docker daemon
# ---------------------------------------------------------------------------
step "Checking Docker daemon..."
if docker info >/dev/null 2>&1; then
  pass "Docker daemon is running"
else
  fail "Docker daemon is not running — start Docker Desktop or 'sudo systemctl start docker'"
fi

# ---------------------------------------------------------------------------
# 2. Docker Compose v2
# ---------------------------------------------------------------------------
step "Checking Docker Compose v2..."
if docker compose version >/dev/null 2>&1; then
  COMPOSE_VER=$(docker compose version --short 2>/dev/null || docker compose version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  pass "Docker Compose v2 found (${COMPOSE_VER})"
else
  fail "Docker Compose v2 not found — upgrade Docker Desktop or install the compose plugin"
fi

# ---------------------------------------------------------------------------
# 3. Node.js >= 24
# ---------------------------------------------------------------------------
step "Checking Node.js version..."
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version)
  if version_gte "${NODE_VER}" "24.0.0"; then
    pass "Node.js ${NODE_VER}"
  else
    fail "Node.js ${NODE_VER} found but >= 24 required — use nvm/fnm to switch: 'nvm use 24'"
  fi
else
  fail "Node.js not found — install from https://nodejs.org or via nvm"
fi

# ---------------------------------------------------------------------------
# 4. pnpm >= 11
# ---------------------------------------------------------------------------
step "Checking pnpm version..."
if command -v pnpm >/dev/null 2>&1; then
  PNPM_VER=$(pnpm --version)
  if version_gte "${PNPM_VER}" "11.0.0"; then
    pass "pnpm ${PNPM_VER}"
  else
    fail "pnpm ${PNPM_VER} found but >= 11 required — run: 'corepack enable && corepack prepare pnpm@11.14.0 --activate'"
  fi
else
  fail "pnpm not found — run: 'corepack enable && corepack prepare pnpm@11.14.0 --activate'"
fi

# ---------------------------------------------------------------------------
# 5. .env file present
# ---------------------------------------------------------------------------
step "Checking .env file..."
if [[ -f "${REPO_ROOT}/.env" ]]; then
  pass ".env file exists"
else
  fail ".env file not found — run: 'cp .env.example .env' then edit as needed"
fi

# ---------------------------------------------------------------------------
# 6. Environment key drift
# ---------------------------------------------------------------------------
step "Checking .env key drift..."
if [[ -f "${REPO_ROOT}/.env.example" && -f "${REPO_ROOT}/.env" ]]; then
  # Extract key names from .env.example — skip comments and blank lines.
  EXAMPLE_KEYS=$(grep -E '^[A-Z_][A-Z0-9_]*=' "${REPO_ROOT}/.env.example" | cut -d= -f1 | sort)
  # Extract key names from .env (including empty-value keys).
  ENV_KEYS=$(grep -E '^[A-Z_][A-Z0-9_]*=' "${REPO_ROOT}/.env" | cut -d= -f1 | sort)

  MISSING_KEYS=()
  while IFS= read -r key; do
    if ! echo "$ENV_KEYS" | grep -qx "$key"; then
      MISSING_KEYS+=("$key")
    fi
  done <<< "$EXAMPLE_KEYS"

  if [[ ${#MISSING_KEYS[@]} -eq 0 ]]; then
    pass "All env vars from .env.example are present in .env"
  else
    warn "Keys absent from .env (schema defaults still apply): ${MISSING_KEYS[*]}"
  fi
elif [[ ! -f "${REPO_ROOT}/.env.example" ]]; then
  warn ".env.example not found — skipping key comparison"
else
  warn ".env not found — skipping key comparison (see check 5)"
fi

# ---------------------------------------------------------------------------
# 7. Required ports free
# ---------------------------------------------------------------------------
sec::source_env API_PORT POSTGRES_PORT REDIS_CACHE_PORT REDIS_QUEUE_PORT \
  MINIO_PORT MINIO_CONSOLE_PORT MAIL_PORT MAILPIT_UI_PORT

PORTS_TO_CHECK=(
  "${API_PORT:-3000}:API"
  "${POSTGRES_PORT:-5432}:PostgreSQL"
  "${REDIS_CACHE_PORT:-6379}:Redis-cache"
  "${REDIS_QUEUE_PORT:-6380}:Redis-queue"
  "${MINIO_PORT:-9000}:MinIO-API"
  "${MINIO_CONSOLE_PORT:-9001}:MinIO-console"
  "${MAIL_PORT:-1025}:Mailpit-SMTP"
  "${MAILPIT_UI_PORT:-8025}:Mailpit-UI"
)

step "Checking host port availability..."
for entry in "${PORTS_TO_CHECK[@]}"; do
  port="${entry%%:*}"
  label="${entry##*:}"
  if port_in_use "$port"; then
    fail "Port ${port} (${label}) is already in use — stop the conflicting process or change \${...}_PORT in .env"
  else
    pass "Port ${port} (${label}) is free"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ $FAIL -eq 0 ]]; then
  sec::ok "All checks passed — you are ready to run ./scripts/build-dev.sh"
  exit 0
else
  sec::err "One or more checks failed — fix the issues above, then re-run ./scripts/doctor.sh"
  exit 1
fi
