-- pg_stat_statements requires shared_preload_libraries to load the extension
-- at Postgres startup. CREATE EXTENSION registers it in this database when
-- the library is loaded; silently no-ops with a NOTICE when not loaded
-- (e.g. on managed Postgres providers that pre-enable it differently).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Reset stats on first install for a clean baseline. Wrapped in a DO block
-- so the migration succeeds whether or not the library is pre-loaded:
--   - Library loaded (self-hosted with overlay, or managed PG): reset executes normally.
--   - Library not loaded (stock Postgres, no shared_preload_libraries flag):
--     pg_stat_statements_reset() raises SQLSTATE 55000 (object_not_in_prerequisite_state).
--     We catch ONLY that specific code so real failures (permission errors,
--     missing functions on rolled-back installs, syntax issues) surface and
--     fail the migration as intended. `WHEN OTHERS` would mask them.
DO $$
BEGIN
  PERFORM pg_stat_statements_reset();
EXCEPTION
  WHEN SQLSTATE '55000' THEN
    RAISE NOTICE 'pg_stat_statements not yet active (SQLSTATE: %) — extension registered but stats unavailable until Postgres restarts with shared_preload_libraries=pg_stat_statements configured.', SQLSTATE;
END $$;
