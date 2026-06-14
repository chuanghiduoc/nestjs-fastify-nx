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

// Three-stage dispatch: CLAIM tx (FOR UPDATE SKIP LOCKED) → PUBLISH (no tx) → MARK tx (per-row).
// Lock windows stay short and a poison-pill listener cannot roll back an entire batch.
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
      this.logger.error(`Outbox stuck-row check failed: ${String(err)}`);
    }
  }

  private async claimBatch(): Promise<OutboxRow[]> {
    return this.prisma.transaction(
      async (tx) => {
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
      },
      { timeout: this.txTimeoutMs },
    );
  }

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
      // Published but mark-processed failed — event WILL redeliver; listeners must be idempotent.
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
