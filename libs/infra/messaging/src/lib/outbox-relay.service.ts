import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { intEnv } from '@nestjs-fastify-nx/shared';
import { EventBusService } from './event-bus.service';
import { OUTBOX_SCHEMA_VERSION } from './outbox-schema-version';
import { OUTBOX_RELAY_LEADERSHIP, type OutboxRelayLeadership } from './outbox-relay-leadership';

interface OutboxPayloadShape {
  // Absent on rows written before envelope versioning — treated as version 1.
  schemaVersion?: number;
  eventId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface OutboxRow {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
}

const STUCK_CHECK_INTERVAL_MS = 60_000;

function parsePayload(value: unknown): OutboxPayloadShape | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<OutboxPayloadShape>;
  if (
    (candidate.schemaVersion !== undefined &&
      (!Number.isInteger(candidate.schemaVersion) || candidate.schemaVersion < 1)) ||
    typeof candidate.eventId !== 'string' ||
    candidate.eventId.length === 0 ||
    typeof candidate.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(candidate.occurredAt)) ||
    typeof candidate.payload !== 'object' ||
    candidate.payload === null ||
    Array.isArray(candidate.payload)
  ) {
    return null;
  }
  return candidate as OutboxPayloadShape;
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
  private inFlight?: Promise<number>;
  private running = false;
  private stopped = false;
  private lastStuckCheckAt?: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
    @Optional()
    @Inject(OUTBOX_RELAY_LEADERSHIP)
    private readonly leadership?: OutboxRelayLeadership,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.tick()
        .catch((err) => {
          // A transient claim/query failure must not become an unhandled rejection that kills the
          // scheduler process. The next interval retries and the outbox rows remain durable.
          this.logger.error(`Outbox relay tick failed: ${String(err)}`);
          return 0;
        })
        .finally(() => {
          this.inFlight = undefined;
        });
    }, this.pollIntervalMs);
    this.timer.unref();
    this.logger.log(
      `Outbox relay started — pollIntervalMs=${this.pollIntervalMs} batchSize=${this.batchSize}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  async tick(): Promise<number> {
    if (this.leadership && !this.leadership.isLeader()) return 0;
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      const claimed = await this.claimBatch();
      if (claimed.length === 0) {
        await this.checkStuckRows();
        return 0;
      }

      // claimBatch() already incremented attempts for every claimed row, so each must be attempted
      // this tick or it silently burns a retry — a failed row is retried later, it doesn't block.
      let dispatched = 0;
      for (const row of claimed) {
        if (await this.dispatchOne(row)) dispatched++;
      }

      await this.checkStuckRows();
      return dispatched;
    } finally {
      this.running = false;
    }
  }

  private async checkStuckRows(): Promise<void> {
    const now = Date.now();
    if (
      this.lastStuckCheckAt !== undefined &&
      now - this.lastStuckCheckAt < STUCK_CHECK_INTERVAL_MS
    ) {
      return;
    }
    this.lastStuckCheckAt = now;

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
              ORDER BY "createdAt", id
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
    const payload = parsePayload(row.payload);
    if (!payload) {
      const message = 'Invalid outbox payload envelope';
      this.logger.error(`Outbox dispatch skipped for ${row.eventType} (id=${row.id}) - ${message}`);
      await this.recordError(row.id, message);
      return false;
    }

    // Reject envelopes newer than this relay understands rather than silently
    // deserialising a shape we cannot interpret. The row exhausts its attempts and
    // surfaces via the stuck-row warning with an explanatory lastError.
    const version = payload.schemaVersion ?? 1;
    if (version > OUTBOX_SCHEMA_VERSION) {
      const message = `Unsupported outbox schemaVersion=${version} (relay supports up to ${OUTBOX_SCHEMA_VERSION}) — producer/consumer deploy skew`;
      this.logger.error(`Outbox dispatch skipped for ${row.eventType} (id=${row.id}) — ${message}`);
      await this.recordError(row.id, message.slice(0, 2_000));
      return false;
    }

    const event: DomainEvent = {
      eventId: payload.eventId,
      eventType: row.eventType,
      aggregateId: row.aggregateId,
      occurredAt: new Date(payload.occurredAt),
      payload: payload.payload,
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
