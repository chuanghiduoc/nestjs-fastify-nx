-- Composite index supporting cursor pagination on /admin/users.
--
-- Repository query:
--   ORDER BY "createdAt" DESC, "id" DESC
--   WHERE ("createdAt", "id") < ($cursorCreatedAt, $cursorId)  -- row-comparison form
--
-- The pre-existing single-column `users_createdAt_idx` covers the ORDER BY
-- on a non-cursor first page but Postgres cannot use it to seek the
-- (createdAt, id) compound predicate — it falls back to filter-after-scan
-- as the table grows, which is exactly the pathology cursor pagination
-- was introduced to avoid. The composite index below makes the seek O(log N)
-- and lets Postgres satisfy the ORDER BY directly from the index without a
-- separate sort step.
--
-- DESC matches the handler's ordering so reverse index scans aren't needed.
-- Idempotent via IF NOT EXISTS so re-runs / branch overlaps are safe.
CREATE INDEX IF NOT EXISTS "users_createdAt_id_desc_idx"
  ON "users" ("createdAt" DESC, "id" DESC);
