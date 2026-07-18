import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { Prisma } from '@prisma/client';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';
import { OUTBOX_SCHEMA_VERSION } from './outbox-schema-version';

interface OutboxPayload extends Prisma.InputJsonObject {
  schemaVersion: number;
  eventId: string;
  occurredAt: string;
  payload: Prisma.InputJsonValue;
}

// PrismaService propagates its interactive transaction through AsyncLocalStorage, so calls made
// inside prisma.transaction(...) use that transaction client. Outside one, this is an event-only
// durable write; producers changing aggregate state must use a trigger or PrismaService.transaction.
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
      id: generateId(), // UUIDv7 — PK locality aligns with event ordering.
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      payload: this.serializePayload(event),
    }));

    const transaction = this.prisma.currentTransaction;
    if (!transaction) {
      // Not an error: an event-only write with no aggregate change is a legitimate use of this
      // path. But a producer that just mutated state outside a transaction has lost the outbox's
      // entire point — the event row and the state change can no longer commit or roll back
      // together. From in here the two cases are indistinguishable, so warn rather than throw and
      // let the log say which producer to look at.
      this.logger.warn(
        `Outbox write outside a transaction (${events.map((e) => e.eventType).join(', ')}) — ` +
          'not atomic with aggregate state. Wrap it in prisma.transaction() if this producer ' +
          'also changed state.',
      );
    }

    try {
      const client = transaction ?? this.prisma.db;
      await client.outboxEvent.createMany({ data: rows });
    } catch (err) {
      this.logger.error(`Outbox persist failed for ${events.length} event(s) — ${String(err)}`);
      throw err;
    }
  }

  private serializePayload(event: DomainEvent): OutboxPayload {
    return {
      schemaVersion: OUTBOX_SCHEMA_VERSION,
      eventId: event.eventId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload as Prisma.InputJsonValue,
    };
  }
}
