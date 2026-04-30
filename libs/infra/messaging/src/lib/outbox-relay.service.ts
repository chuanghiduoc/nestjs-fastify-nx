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
 *   OUTBOX_POLL_INTERVAL_MS — milliseconds between polling cycles (default 1000)
 *   OUTBOX_BATCH_SIZE      — max rows fetched per cycle (default 50)
 *   OUTBOX_MAX_ATTEMPTS    — rows beyond this attempt count are skipped and
 *                            require manual inspection (default 10)
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
      return await this.dispatchBatch();
    } finally {
      this.running = false;
    }
  }

  /**
   * Claim a batch of rows atomically: select unprocessed rows with
   * `FOR UPDATE SKIP LOCKED`, bump their `attempts` counter and return them.
   * The bump acts as a soft lock that survives transaction commit — once a
   * row's `attempts` is incremented, another relay instance picking it up in
   * a later cycle will see the new value, but it will still respect the
   * `processedAt IS NULL` guard until we mark it processed below.
   *
   * If the relay crashes between claim and publish, the row remains
   * unprocessed but with attempts > 0; the polling loop will retry up to
   * `maxAttempts` before giving up.
   */
  private async dispatchBatch(): Promise<number> {
    const rows = await this.prisma.transaction(async (tx) => {
      const claimed = await tx.$queryRawUnsafe<OutboxRow[]>(
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
      return claimed;
    });

    if (rows.length === 0) return 0;

    let dispatched = 0;
    for (const row of rows) {
      try {
        const event: DomainEvent = {
          eventId: row.payload.eventId,
          eventType: row.eventType,
          aggregateId: row.aggregateId,
          occurredAt: new Date(row.payload.occurredAt),
          payload: row.payload.payload,
        };
        await this.bus.publish(event);
        await this.prisma.db.outboxEvent.update({
          where: { id: row.id },
          data: { processedAt: new Date(), lastError: null },
        });
        dispatched++;
      } catch (err) {
        const message = String(err);
        this.logger.error(
          `Outbox dispatch failed for ${row.eventType} (id=${row.id}, attempt=${row.attempts}) — ${message}`,
        );
        await this.prisma.db.outboxEvent.update({
          where: { id: row.id },
          data: { lastError: message.slice(0, 2_000) },
        });
      }
    }
    return dispatched;
  }
}
