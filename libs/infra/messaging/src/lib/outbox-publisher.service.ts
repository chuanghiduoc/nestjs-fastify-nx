import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { Prisma } from '@prisma/client';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';

interface OutboxPayload extends Prisma.InputJsonObject {
  eventId: string;
  occurredAt: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Transactional-outbox adapter for `EventPublisherPort`.
 *
 * Persists each domain event into the `outbox_events` table inside the same
 * database connection as the surrounding command — application code is
 * expected to call `publishAll(...)` from within a Prisma interactive
 * transaction so the writes are atomic with the aggregate's state changes.
 *
 * A separate relay process (`OutboxRelayService`) is responsible for
 * delivering persisted events to in-process listeners or to an external
 * broker; this adapter intentionally does NOT emit anything itself.
 *
 * The payload column stores `{ eventId, occurredAt, payload }` so the relay
 * can reconstruct an in-memory event with the same shape consumers received
 * from the in-process emitter.
 */
@Injectable()
export class OutboxPublisher implements EventPublisherPort {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(private readonly prisma: PrismaService) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.persist([event]);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.persist(events);
  }

  private async persist(events: DomainEvent[]): Promise<void> {
    const rows = events.map((event) => ({
      // App-stamped UUIDv7 — the producer needs the id inside the surrounding
      // transaction to correlate aggregate writes with the outbox row, and v7
      // ordering keeps PK locality aligned with event-occurred ordering.
      id: generateId(),
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      payload: this.serializePayload(event),
    }));

    try {
      await this.prisma.db.outboxEvent.createMany({ data: rows });
    } catch (err) {
      this.logger.error(`Outbox persist failed for ${events.length} event(s) — ${String(err)}`);
      throw err;
    }
  }

  private serializePayload(event: DomainEvent): OutboxPayload {
    return {
      eventId: event.eventId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload as Prisma.InputJsonValue,
    };
  }
}
