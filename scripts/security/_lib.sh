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

# Source .env if present so IMAGE_REGISTRY/NAMESPACE/TAG resolve consistently
# with build-prod.sh and docker compose. Tolerates absence (CI passes via env).
sec::source_env() {
  local root; root="$(sec::repo_root)"
  if [[ -f "${root}/.env" ]]; then
    set -a; # shellcheck disable=SC1091
    source "${root}/.env"; set +a
  fi
}
