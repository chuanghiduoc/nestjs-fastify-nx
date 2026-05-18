import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { intEnv } from '@nestjs-fastify-nx/shared';
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

/**
 * Reads unprocessed rows from the `outbox_events` table and dispatches them
 * through the in-process `EventBusService`. Designed to be hosted by exactly
 * one process (typically the scheduler app); concurrency safety relies on
 * Postgres `FOR UPDATE SKIP LOCKED` so additional replicas remain correct
 * even if the operator accidentally runs more than one instance.
 *
 * Three-stage dispatch (refactored from single-tx design):
 *   1. CLAIM tx: SELECT ... FOR UPDATE SKIP LOCKED + increment attempts. Lock
 *      released the moment this tx commits — other replicas can immediately
 *      claim the NEXT batch without waiting for our publish loop.
 *   2. PUBLISH (no tx): bus.publish() runs without holding any row lock. A
 *      slow listener cannot bottleneck the claim throughput.
 *   3. MARK tx: per-row UPDATE setting processedAt or lastError. Each row
 *      committed independently so a single poison-pill listener cannot roll
 *      back an entire batch.
 *
 * Configuration (env):
 *   OUTBOX_POLL_INTERVAL_MS  — milliseconds between polling cycles (default 1000)
 *   OUTBOX_BATCH_SIZE        — max rows fetched per cycle (default 50)
 *   OUTBOX_MAX_ATTEMPTS      — rows beyond this attempt count are skipped and
 *                              require manual inspection (default 10)
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly pollIntervalMs = intEnv('OUTBOX_POLL_INTERVAL_MS', 1_000);
  private readonly batchSize = intEnv('OUTBOX_BATCH_SIZE', 50);
  private readonly maxAttempts = intEnv('OUTBOX_MAX_ATTEMPTS', 10);
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
      const claimed = await this.claimBatch();
      if (claimed.length === 0) {
        await this.checkStuckRows();
        return 0;
      }

      let dispatched = 0;
      for (const row of claimed) {
        const ok = await this.dispatchOne(row);
        if (ok) dispatched++;
      }

      // Stuck-row monitoring kept outside the dispatch loop so a stuck event
      // count check doesn't add latency to the publish path.
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
   * Stage 1: short-lived claim transaction. Locks N rows, increments attempts,
   * commits. Lock released before publish so peer replicas can claim the next
   * batch immediately. Rows whose attempts have already exceeded maxAttempts
   * are excluded — they remain invisible until ops manually resets attempts.
   */
  private async claimBatch(): Promise<OutboxRow[]> {
    return this.prisma.transaction(async (tx) => {
      return tx.$queryRawUnsafe<OutboxRow[]>(
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
    });
  }

  /**
   * Stage 2 + 3 for a single row: publish (no tx) → mark processed/error
   * (per-row tx). Returns true when the event was delivered, false when the
   * bus threw and lastError was recorded.
   */
  private async dispatchOne(row: OutboxRow): Promise<boolean> {
    const event: DomainEvent = {
      eventId: row.payload.eventId,
      eventType: row.eventType,
      aggregateId: row.aggregateId,
      occurredAt: new Date(row.payload.occurredAt),
      payload: row.payload.payload,
    };

    try {
      await this.bus.publish(event);
    } catch (err) {
      const message = String(err);
      this.logger.error(
        `Outbox dispatch failed for ${row.eventType} (id=${row.id}, attempt=${row.attempts}) — ${message}`,
      );
      await this.recordError(row.id, message.slice(0, 2_000));
      return false;
    }

    try {
      await this.markProcessed(row.id);
      return true;
    } catch (err) {
      // Mark-processed failure is dangerous: the listener ran, but we cannot
      // persist that fact. Next tick will redeliver the event. Log loudly so
      // ops know to expect duplicate side-effects and consider listener
      // idempotency before they panic.
      this.logger.error(
        `Outbox row ${row.id} (${row.eventType}) was published but mark-processed failed — event WILL be redelivered. ${String(err)}`,
      );
      return false;
    }
  }

  private async markProcessed(id: string): Promise<void> {
    await this.prisma.db.$executeRawUnsafe(
      `UPDATE "outbox_events" SET "processedAt" = $1, "lastError" = NULL WHERE id = $2`,
      new Date(),
      id,
    );
  }

  private async recordError(id: string, message: string): Promise<void> {
    try {
      await this.prisma.db.$executeRawUnsafe(
        `UPDATE "outbox_events" SET "lastError" = $1 WHERE id = $2`,
        message,
        id,
      );
    } catch (err) {
      this.logger.error(`Failed to record outbox lastError for ${id}: ${String(err)}`);
    }
  }
}
