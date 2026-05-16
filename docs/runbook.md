# Runbook — nestjs-fastify-nx

Operational runbook for on-call engineers. Each section follows the pattern:
**Symptom → Diagnostic → Action → Escalation**.

---

## 1. Outbox stuck

**Symptom:** Domain events stop flowing. Downstream listeners (audit-log, notifications) are silent. `outbox_events` rows accumulate with `processed_at IS NULL`.

**Diagnostic:**

```sql
-- Find events that have exhausted retry attempts
SELECT id, event_type, aggregate_id, attempts, created_at, last_error
FROM outbox_events
WHERE processed_at IS NULL
  AND attempts >= 10
ORDER BY created_at ASC
LIMIT 50;

-- Count stuck vs in-flight events
SELECT
  CASE WHEN attempts >= 10 THEN 'exhausted' ELSE 'retrying' END AS state,
  COUNT(*)
FROM outbox_events
WHERE processed_at IS NULL
GROUP BY 1;
```

```bash
# Check scheduler logs for relay errors
docker compose logs scheduler --tail=200 | grep -i "outbox\|error\|failed"
```

**Action:**

1. Fix the root cause (broken listener, downstream service down, schema mismatch).
2. Reset `attempts` to allow a replay — do this only after the root cause is fixed:

```sql
-- Reset specific event types for replay
UPDATE outbox_events
SET attempts = 0, last_error = NULL
WHERE processed_at IS NULL
  AND event_type = 'users.registered'
  AND attempts >= 10;
```

3. The scheduler's outbox relay picks up rows with `attempts < OUTBOX_MAX_ATTEMPTS` on the next poll cycle (`OUTBOX_POLL_INTERVAL_MS`, default 1 s).
4. Monitor `processed_at` population over the next minute.

**Escalation:** If events are still stuck after reset, check `OUTBOX_TX_TIMEOUT_MS` (default 30 s) — a too-short timeout causes P2028 rollback loops. Increase and redeploy.

---

## 2. DLQ full (BullMQ)

**Symptom:** Worker stops processing jobs. Bull Board (`/api/admin/queues`) shows a large failed job count. New jobs queue but never complete.

**Diagnostic:**

```bash
# List failed jobs via Bull Board UI
open http://localhost:3000/api/admin/queues

# Or inspect via Redis CLI
redis-cli -h $REDIS_QUEUE_HOST -p $REDIS_QUEUE_PORT
> LLEN bull:email-notification:failed
> LRANGE bull:email-notification:failed 0 9
```

```bash
# Worker logs for the failure reason
docker compose logs worker --tail=200 | grep -E "failed|error|exception"
```

**Action:**

1. Identify the failure pattern (all same job type? started after a deploy?).
2. Fix the root cause in the worker handler.
3. Redeploy the worker: `docker compose up -d --no-deps worker`.
4. Replay failed jobs from Bull Board → select failed jobs → "Retry all" button.
   Or via Redis CLI — move jobs back to waiting:

```bash
# Retry all failed jobs in a queue (Bull Board preferred; CLI for automation)
redis-cli -h $REDIS_QUEUE_HOST -p $REDIS_QUEUE_PORT
> LRANGE bull:email-notification:failed 0 -1
# Pipe each job ID through `bull:email-notification:retry <id>` using bullmq CLI if installed
```

5. Purge genuinely unrecoverable jobs (data from a bad deploy) after confirming replay is safe:
   Bull Board → "Clean" → select "failed" state → confirm.

**Escalation:** If the queue fills faster than the worker can drain (sustained spike), scale the worker replicas via Coolify or increase `BULLMQ_CONCURRENCY`. Alert the team if a runaway job producer is suspected.

---

## 3. Audit log missing events

**Symptom:** Compliance query returns fewer audit records than expected. Users report actions not appearing in the audit trail.

**Diagnostic:**

```bash
# Check audit-log listener logs for subscription errors
docker compose logs api --tail=500 | grep -i "audit"

# Check if outbox relay is delivering the events
docker compose logs scheduler --tail=200 | grep "outbox"
```

```sql
-- Check if outbox has the event but audit_logs does not
SELECT o.event_type, o.aggregate_id, o.processed_at, o.last_error
FROM outbox_events o
WHERE o.event_type LIKE 'users.%'
  AND o.created_at > NOW() - INTERVAL '1 hour'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.entity_id = o.aggregate_id
      AND a.created_at > o.created_at - INTERVAL '5 seconds'
  )
ORDER BY o.created_at DESC
LIMIT 20;
```

**Action:**

1. If outbox rows show `processed_at IS NOT NULL` but audit rows are absent: the audit listener threw an error silently. Check for schema mismatch or a bug in the listener — redeploy after fix.
2. If outbox rows show `processed_at IS NULL`: the relay is stuck — follow the **Outbox stuck** runbook section above.
3. To replay a specific event, reset its `attempts` and `processed_at`:

```sql
UPDATE outbox_events
SET attempts = 0, processed_at = NULL, last_error = NULL
WHERE id = '<event-uuid>';
```

**Escalation:** If missing audit records span a time window matching a deployment, check whether a migration altered the `audit_logs` partition for that month. Verify partition existence:

```sql
SELECT inhrelid::regclass FROM pg_inherits
WHERE inhparent = 'audit_logs'::regclass
ORDER BY 1;
```

---

## 4. Redis down

**Symptom:** API returns 503 on health check (`/api/v1/health/ready`). BullMQ job processing halted. Session validation failing or slow (Better Auth cache miss).

**Diagnostic:**

```bash
# Check Redis container status
docker compose ps redis-cache redis-queue

# Ping Redis directly
redis-cli -h $REDIS_CACHE_HOST -p $REDIS_CACHE_PORT ping
redis-cli -h $REDIS_QUEUE_HOST -p $REDIS_QUEUE_PORT ping

# Check Redis logs
docker compose logs redis-cache --tail=100
docker compose logs redis-queue --tail=100
```

**Fallback behavior while Redis is down:**

- **Session auth**: Better Auth falls back to DB verification (slower, higher DB load).
- **BullMQ**: Jobs queue in memory briefly; if the connection times out, new job enqueues fail with a 500.
- **Cache (redis-cache)**: Cache misses — all reads go to DB. Expect elevated DB CPU.
- **Socket.io pub/sub**: Disconnects; WebSocket clients will need to reconnect.

**Action:**

1. Restart the affected Redis container:

```bash
docker compose restart redis-cache
# or
docker compose restart redis-queue
```

2. If the container won't start (OOM, disk full), check host resources:

```bash
df -h        # disk usage
free -m      # memory
docker stats # per-container resource use
```

3. If data persistence is needed (RDB/AOF): verify the volume is intact before restart.
4. After restart, confirm health endpoint returns 200:

```bash
curl -s http://localhost:3000/api/v1/health/ready | jq .
```

**Escalation:** If Redis keeps crashing (OOM killer, maxmemory policy eviction storm), set `maxmemory-policy allkeys-lru` and size `maxmemory` appropriately. Engage infrastructure team if running on managed Redis (ElastiCache, Upstash, Redis Cloud).

---

## 5. Migration fail

**Symptom:** Deployment pipeline fails at the migration step. The `migration` container exits non-zero. API/worker containers hang in "Created" state because `service_completed_successfully` is not satisfied.

**Diagnostic:**

```bash
# See the exact migration error
docker compose logs migration

# Check which migration failed
docker compose exec postgres psql -U postgres -d nestjs_db \
  -c "SELECT migration_name, finished_at, applied_steps_count, logs
      FROM _prisma_migrations
      WHERE finished_at IS NULL OR applied_steps_count = 0
      ORDER BY started_at DESC LIMIT 5;"
```

**Action:**

1. **Do not retry the migration** until the root cause is understood — a half-applied migration with destructive DDL (DROP COLUMN, etc.) may leave the schema inconsistent.

2. If the migration is idempotent and safe to re-run (e.g. a connectivity blip caused the failure):

```bash
docker compose run --rm migration
```

3. If the migration applied partial DDL and must be rolled back:

```bash
# Connect to DB and inspect current schema state
docker compose exec postgres psql -U postgres -d nestjs_db

# Manually reverse the DDL if no automatic rollback exists (Prisma does not
# generate down migrations — the rollback SQL must be written manually).
# Example: if a column was added and needs removal:
# ALTER TABLE users DROP COLUMN IF EXISTS new_column;
```

4. After manual rollback, mark the failed migration as rolled back:

```sql
-- Remove the failed migration record so Prisma can reapply it cleanly
DELETE FROM _prisma_migrations WHERE migration_name = '20260516_failing_migration';
```

5. Fix the migration file, commit, redeploy.

**Prevention:**

- Always use additive-only migrations in production (add columns nullable first, backfill, then add NOT NULL constraint in a second migration).
- Test migrations against a production-sized DB snapshot in staging before merging.

**Escalation:** If the schema is in an unknown state and the DB cannot be brought back online, restore from the last snapshot taken before the migration run. Engage the DBA team and document the incident timeline.
