#!/usr/bin/env bash
# Postgres logical backup / restore for the compose stack.
#
# The runbook's recovery steps assume a snapshot exists to restore from. This
# script is the minimum that makes that assumption true: an on-demand, verifiable
# pg_dump in custom format (compressed, restorable with pg_restore). Scheduling
# and OFF-HOST retention are the operator's responsibility — a backup that lives
# on the same volume as the database it protects is not a backup. Wire this into
# cron / a systemd timer / a CI job and copy the artifact to object storage that
# is NOT the same MinIO/S3 instance the app writes uploads to.
#
# Usage:
#   ./scripts/pg-backup.sh backup [OUT_DIR]      # default OUT_DIR=./backups
#   ./scripts/pg-backup.sh restore <DUMP_FILE>   # DESTRUCTIVE — overwrites the DB
#
# Env (read from .env, then the process environment, then these defaults):
#   POSTGRES_USER (postgres)  POSTGRES_DB (nestjs_db)  PG_SERVICE (postgres)
#   COMPOSE_FILES (docker/compose.yml -f docker/compose.dev.yml) — override for a prod stack.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/security/_lib.sh"
cd "$(sec::repo_root)"

# Otherwise the defaults below win over .env and restore (--clean --if-exists) hits the wrong DB.
sec::source_env POSTGRES_USER POSTGRES_DB PG_SERVICE COMPOSE_FILES

PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-nestjs_db}"
# The base file alone is not a valid project: migration/worker/scheduler get their image from an
# overlay, so compose fails validation before reaching postgres.
COMPOSE_FILES="${COMPOSE_FILES:-docker/compose.yml -f docker/compose.dev.yml}"

# --env-file: the compose files live under docker/, so interpolation would miss the root .env.
# shellcheck disable=SC2086
compose() { docker compose --env-file .env -f $COMPOSE_FILES "$@"; }

cmd="${1:-}"
case "$cmd" in
  backup)
    out_dir="${2:-./backups}"
    mkdir -p "$out_dir"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    out_file="${out_dir}/${PG_DB}-${stamp}.dump"
    echo "Backing up ${PG_DB} → ${out_file}"
    # -Fc = custom format (compressed, selective restore). Stream to the host file.
    # `|| rc=$?` instead of a bare call: under `set -e` a failing pg_dump would abort the
    # script here, leaving the truncated file the redirect already created — the exact
    # "useless file" the check below exists to prevent.
    rc=0
    compose exec -T "$PG_SERVICE" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$out_file" || rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "ERROR: pg_dump exited ${rc} — backup FAILED" >&2
      rm -f "$out_file"
      exit 1
    fi
    if [ ! -s "$out_file" ]; then
      echo "ERROR: dump is empty — backup FAILED" >&2
      rm -f "$out_file"
      exit 1
    fi
    # A non-empty file can still be a truncated stream. pg_restore -l parses the custom-format
    # archive's table of contents, so it fails on a partial dump that the size check accepts.
    if ! compose exec -T "$PG_SERVICE" pg_restore -l < "$out_file" > /dev/null 2>&1; then
      echo "ERROR: dump is unreadable by pg_restore — truncated or corrupt. Backup FAILED" >&2
      rm -f "$out_file"
      exit 1
    fi
    echo "OK ($(du -h "$out_file" | cut -f1)). Copy this OFF-HOST now — do not rely on local disk."
    ;;
  restore)
    dump_file="${2:-}"
    [ -n "$dump_file" ] && [ -f "$dump_file" ] || { echo "Usage: $0 restore <DUMP_FILE>" >&2; exit 1; }
    echo "WARNING: this OVERWRITES database '${PG_DB}'. Ctrl-C within 5s to abort."
    sleep 5
    # --clean --if-exists drops existing objects first; single transaction so a
    # failed restore rolls back instead of leaving a half-restored schema.
    compose exec -T "$PG_SERVICE" pg_restore -U "$PG_USER" -d "$PG_DB" \
      --clean --if-exists --single-transaction < "$dump_file"
    echo "Restore complete."
    ;;
  *)
    echo "Usage: $0 {backup [OUT_DIR] | restore <DUMP_FILE>}" >&2
    exit 1
    ;;
esac
