#!/bin/sh
set -eu

: "${POSTGRES_ADMIN_USER:?required}"
: "${POSTGRES_ADMIN_PASSWORD:?required}"
: "${POSTGRES_DB:?required}"
: "${API_DB_USER:?required}"
: "${API_DB_PASSWORD:?required}"
: "${WORKER_DB_USER:?required}"
: "${WORKER_DB_PASSWORD:?required}"
: "${SCHEDULER_DB_USER:?required}"
: "${SCHEDULER_DB_PASSWORD:?required}"

export PGPASSWORD="$POSTGRES_ADMIN_PASSWORD"
run_psql() {
  psql --host=postgres --username="$POSTGRES_ADMIN_USER" --dbname="$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 \
    --set=admin_user="$POSTGRES_ADMIN_USER" \
    --set=api_user="$API_DB_USER" --set=api_password="$API_DB_PASSWORD" \
    --set=worker_user="$WORKER_DB_USER" --set=worker_password="$WORKER_DB_PASSWORD" \
    --set=scheduler_user="$SCHEDULER_DB_USER" --set=scheduler_password="$SCHEDULER_DB_PASSWORD"
}

attempt=1
while ! run_psql <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'api_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'api_user') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'worker_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'worker_user') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'scheduler_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'scheduler_user') \gexec

ALTER ROLE :"api_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'api_password';
ALTER ROLE :"worker_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'worker_password';
ALTER ROLE :"scheduler_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'scheduler_password';

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"api_user", :"worker_user", :"scheduler_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"api_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"api_user";

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"worker_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE stored_files TO :"worker_user";

GRANT SELECT, INSERT, UPDATE, DELETE, MAINTAIN ON ALL TABLES IN SCHEMA public TO :"scheduler_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"scheduler_user";
GRANT CREATE ON SCHEMA public TO :"scheduler_user";
GRANT EXECUTE ON FUNCTION public.ensure_audit_log_partition(timestamptz) TO :"scheduler_user";
GRANT EXECUTE ON FUNCTION public.drop_expired_audit_log_partitions(date) TO :"scheduler_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"api_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"api_user";
SQL
do
  if [ "$attempt" -ge 20 ]; then
    echo "database role provisioning failed after ${attempt} attempts" >&2
    exit 1
  fi
  echo "database not ready or migrations incomplete; retrying (${attempt}/20)" >&2
  attempt=$((attempt + 1))
  sleep 5
done
