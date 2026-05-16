import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { EventBusService } from './event-bus.service';

interface OutboxPayloadShape {
  eventId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface OutboxRow {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: OutboxPayloadShape;
  attempts: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads unprocessed rows from the `outbox_events` table and dispatches them
 * through the in-process `EventBusService`. Designed to be hosted by exactly
 * one process (typically the scheduler app); concurrency safety relies on
 * Postgres `FOR UPDATE SKIP LOCKED` so additional replicas remain correct
 * even if the operator accidentally runs more than one instance.
 *
 * Configuration (env):
 *   OUTBOX_POLL_INTERVAL_MS  — milliseconds between polling cycles (default 1000)
 *   OUTBOX_BATCH_SIZE        — max rows fetched per cycle (default 50)
 *   OUTBOX_MAX_ATTEMPTS      — rows beyond this attempt count are skipped and
 *                              require manual inspection (default 10)
 *   OUTBOX_TX_TIMEOUT_MS     — Prisma interactive-transaction timeout in ms
 *                              (default 30000). The default Prisma timeout of
 *                              5000 ms is too short when batchSize rows trigger
 *                              synchronous DB writes inside bus.publish (e.g.
 *                              audit-log listener). Exceeding the timeout causes
 *                              a P2028 rollback which rolls back processedAt →
 *                              every published event re-fires on the next tick.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly pollIntervalMs = intEnv('OUTBOX_POLL_INTERVAL_MS', 1_000);
  private readonly batchSize = intEnv('OUTBOX_BATCH_SIZE', 50);
  private readonly maxAttempts = intEnv('OUTBOX_MAX_ATTEMPTS', 10);
  private readonly txTimeoutMs = intEnv('OUTBOX_TX_TIMEOUT_MS', 30_000);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.logger.log(
      `Outbox relay started — pollIntervalMs=${this.pollIntervalMs} batchSize=${this.batchSize}`,
    );
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One polling cycle. Exposed so tests and operators can drive the relay
   * deterministically. Skips its body if a previous cycle is still in flight
   * (the polling timer is fire-and-forget; we don't want overlapping ticks).
   */
  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      const dispatched = await this.dispatchBatch();
      // Rows with attempts >= maxAttempts are excluded from the claim WHERE clause
      // and are never dispatched or warned inside dispatchBatch (they are simply
      // invisible to the relay). A separate count surfaces them so operators can
      // act before the backlog silently grows.
      await this.checkStuckRows();
      return dispatched;
    } finally {
      this.running = false;
    }
  }

  private async checkStuckRows(): Promise<void> {
    try {
      const result = await this.prisma.db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) AS count FROM "outbox_events" WHERE attempts >= $1 AND "processedAt" IS NULL`,
        this.maxAttempts,
      );
      const stuck = Number(result[0]?.count ?? 0);
      if (stuck > 0) {
        this.logger.warn(
          `Outbox has ${stuck} permanently-stuck row(s) (attempts >= maxAttempts=${this.maxAttempts}); manual intervention required`,
        );
      }
    } catch (err) {
      // Non-fatal — stuck-row monitoring must not disrupt normal relay operation.
      this.logger.error(`Outbox stuck-row check failed: ${String(err)}`);
    }
  }

  /**
   * Claim, publish, and mark rows processed — all within a single transaction.
   *
   * Keeping the Postgres row-level lock alive until after publish prevents a
   * second replica from re-claiming the same row while the first is mid-flight.
   * The trade-off is a slightly longer transaction (~ms for the publish call),
   * which is acceptable given that the bus call is in-process.
   *
   * Row-level isolation guarantees:
   *   - Claim: `FOR UPDATE SKIP LOCKED` acquires exclusive locks.
   *   - Publish: executes inside the open transaction (lock still held).
   *   - Mark processed / record error: committed atomically at the end.
   *   - On crash between claim and commit: the transaction rolls back,
   *     attempts was incremented by the UPDATE, so the row retries up to
   *     `maxAttempts` before requiring manual intervention.
   */
  private async dispatchBatch(): Promise<number> {
    return this.prisma.transaction(
      async (tx) => {
        const rows = await tx.$queryRawUnsafe<OutboxRow[]>(
          `WITH locked AS (
           SELECT id
           FROM "outbox_events"
           WHERE "processedAt" IS NULL AND attempts < $1
           ORDER BY "createdAt"
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE "outbox_events" o
            SET attempts = o.attempts + 1
           FROM locked
          WHERE o.id = locked.id
         RETURNING o.id, o."eventType", o."aggregateId", o.payload, o.attempts`,
          this.maxAttempts,
          this.batchSize,
        );

        if (rows.length === 0) return 0;

        let dispatched = 0;
        for (const row of rows) {
          if (row.attempts > this.maxAttempts) {
            // Row has exhausted retries — log a warning so ops can inspect and
            // manually resolve the stuck event without silently dropping it.
            this.logger.warn(
              `Outbox row ${row.id} (${row.eventType}) has exceeded maxAttempts=${this.maxAttempts} — skipping; manual intervention required`,
            );
            continue;
          }

          try {
            const event: DomainEvent = {
              eventId: row.payload.eventId,
              eventType: row.eventType,
              aggregateId: row.aggregateId,
              occurredAt: new Date(row.payload.occurredAt),
              payload: row.payload.payload,
            };
            await this.bus.publish(event);
            await tx.$executeRawUnsafe(
              `UPDATE "outbox_events" SET "processedAt" = $1, "lastError" = NULL WHERE id = $2`,
              new Date(),
              row.id,
            );
            dispatched++;
          } catch (err) {
            const message = String(err);
            this.logger.error(
              `Outbox dispatch failed for ${row.eventType} (id=${row.id}, attempt=${row.attempts}) — ${message}`,
            );
            await tx.$executeRawUnsafe(
              `UPDATE "outbox_events" SET "lastError" = $1 WHERE id = $2`,
              message.slice(0, 2_000),
              row.id,
            );
          }
        }
        return dispatched;
      },
      { timeout: this.txTimeoutMs, maxWait: 5_000 },
    );
  }
}
