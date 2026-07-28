-- Runtime scheduler roles must not own application tables. Keep partition DDL behind tightly scoped
-- SECURITY DEFINER functions owned by the migration role, with a fixed search_path.
ALTER FUNCTION public.ensure_audit_log_partition(timestamptz) SECURITY DEFINER;
ALTER FUNCTION public.ensure_audit_log_partition(timestamptz)
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.ensure_audit_log_partition(timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.drop_expired_audit_log_partitions(cutoff_month date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  partition_name text;
  partition_month date;
  dropped integer := 0;
BEGIN
  FOR partition_name IN
    SELECT child.relname
      FROM pg_inherits i
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_class child ON child.oid = i.inhrelid
     WHERE parent.relname = 'audit_logs'
       AND child.relname ~ '^audit_logs_[0-9]{4}_(0[1-9]|1[0-2])$'
  LOOP
    partition_month := to_date(substring(partition_name FROM 12), 'YYYY_MM');
    IF partition_month < cutoff_month THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END;
$$;
REVOKE ALL ON FUNCTION public.drop_expired_audit_log_partitions(date) FROM PUBLIC;
