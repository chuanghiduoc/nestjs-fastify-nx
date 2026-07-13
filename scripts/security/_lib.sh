#!/usr/bin/env bash
# Shared helpers for scripts/security/*.sh — safe to source from any Bash 4+.
set -euo pipefail

# Paint output only when stdout is a TTY; CI logs stay clean.
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_RST=''
fi

sec::log()  { echo "${C_BLU}==>${C_RST} $*"; }
sec::ok()   { echo "${C_GRN}✓${C_RST} $*"; }
sec::warn() { echo "${C_YLW}!${C_RST} $*" >&2; }
sec::err()  { echo "${C_RED}✗${C_RST} $*" >&2; }

# Repo root regardless of caller location.
sec::repo_root() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${lib_dir}/../.." && pwd
}

# MSYS_NO_PATHCONV bypass for Git-Bash on Windows; harmless on Linux/macOS.
sec::docker_run() {
  MSYS_NO_PATHCONV=1 docker run "$@"
}

# Import an explicit allowlist from .env without executing it as shell code.
# Existing process environment values take precedence, matching Compose.
sec::source_env() {
  local root env_file key line value first last
  root="$(sec::repo_root)"
  env_file="${root}/.env"
  [[ -f "$env_file" ]] || return 0

  for key in "$@"; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    printenv "$key" >/dev/null 2>&1 && continue
    line="$(grep -m 1 -E "^${key}=" "$env_file" || true)"
    [[ -n "$line" ]] || continue
    value="${line#*=}"
    value="${value%$'\r'}"
    first="${value:0:1}"
    last="${value: -1}"
    if [[ ${#value} -ge 2 && "$first" == "$last" && ( "$first" == "\"" || "$first" == "'" ) ]]; then
      value="${value:1:${#value}-2}"
    else
      value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')"
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
  done
}
