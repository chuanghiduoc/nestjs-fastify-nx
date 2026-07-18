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
# Env (mirrors compose.yml defaults):
#   POSTGRES_USER (postgres)  POSTGRES_DB (nestjs_db)  PG_SERVICE (postgres)
#   COMPOSE_FILES (docker/compose.yml) — override to target a prod overlay.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-nestjs_db}"
COMPOSE_FILES="${COMPOSE_FILES:-docker/compose.yml}"

# shellcheck disable=SC2086
compose() { docker compose -f $COMPOSE_FILES "$@"; }

cmd="${1:-}"
case "$cmd" in
  backup)
    out_dir="${2:-./backups}"
    mkdir -p "$out_dir"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    out_file="${out_dir}/${PG_DB}-${stamp}.dump"
    echo "Backing up ${PG_DB} → ${out_file}"
    # -Fc = custom format (compressed, selective restore). Stream to the host file.
    compose exec -T "$PG_SERVICE" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$out_file"
    # Fail loud if the dump is empty/truncated rather than leaving a useless file.
    if [ ! -s "$out_file" ]; then
      echo "ERROR: dump is empty — backup FAILED" >&2
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
