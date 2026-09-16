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
    --set=db_name="$POSTGRES_DB" \
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

-- api_user is the RLS-enforced request path: it must NOT hold BYPASSRLS. worker and scheduler are
-- the cross-tenant system path (queue processing, retention sweeps, outbox relay) and cannot carry a
-- per-request organization context, so they bypass instead.
ALTER ROLE :"api_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'api_password';
ALTER ROLE :"worker_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD :'worker_password';
ALTER ROLE :"scheduler_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD :'scheduler_password';

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO :"api_user", :"worker_user", :"scheduler_user";

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"api_user", :"worker_user", :"scheduler_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"api_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"api_user";
REVOKE ALL ON TABLE "_prisma_migrations" FROM :"api_user";
REVOKE UPDATE, DELETE ON TABLE "outbox_events" FROM :"api_user";

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"worker_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "stored_files" TO :"worker_user";

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"scheduler_user";
GRANT MAINTAIN ON ALL TABLES IN SCHEMA public TO :"scheduler_user";
GRANT SELECT, DELETE ON TABLE "users", "sessions", "verifications" TO :"scheduler_user";
GRANT SELECT, UPDATE, DELETE ON TABLE "stored_files" TO :"scheduler_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "outbox_events" TO :"scheduler_user";
GRANT SELECT, INSERT ON TABLE "audit_logs", "notifications" TO :"scheduler_user";
-- No CREATE on the schema: partition DDL runs through the two SECURITY DEFINER functions below,
-- which execute as their migration-role owner. Granting CREATE would hand a compromised scheduler
-- the ability to create arbitrary objects in public — the capability those functions exist to avoid.
GRANT EXECUTE ON FUNCTION public.ensure_audit_log_partition(timestamptz) TO :"scheduler_user";
GRANT EXECUTE ON FUNCTION public.drop_expired_audit_log_partitions(date) TO :"scheduler_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"api_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"api_user";
-- ALTER DEFAULT PRIVILEGES is additive and persists in pg_default_acl, so a deployment provisioned
-- by an earlier revision of this script still carries the blanket DML entry. Re-running the tightened
-- GRANT alone would leave it in place and this whole restriction would silently not apply.
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM :"scheduler_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM :"scheduler_user";
-- Without these the scheduler silently loses the ability to VACUUM every table added by a later
-- migration: the GRANTs above only cover tables that existed when this script ran. MAINTAIN is what
-- lets the weekly VACUUM ANALYZE also cover the monthly audit_logs partitions created afterwards by
-- ensure_audit_log_partition (owned by the admin role); without it VACUUM skips them with a warning.
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  GRANT SELECT, MAINTAIN ON TABLES TO :"scheduler_user";
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
