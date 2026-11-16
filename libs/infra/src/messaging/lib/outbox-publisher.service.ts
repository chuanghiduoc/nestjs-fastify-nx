import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import type { Prisma } from '@nestjs-fastify-nx/infra/database';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';
import { OUTBOX_SCHEMA_VERSION } from './outbox-schema-version';
import type { OutboxEnvelope } from './outbox-envelope';

interface OutboxPayload extends Prisma.InputJsonObject {
  schemaVersion: OutboxEnvelope['schemaVersion'];
  eventId: OutboxEnvelope['eventId'];
  occurredAt: OutboxEnvelope['occurredAt'];
  payload: Prisma.InputJsonValue;
}

// PrismaService propagates its interactive transaction through AsyncLocalStorage, so calls made
// inside prisma.transaction(...) use that transaction client. Outside one, this is an event-only
// durable write; producers changing aggregate state must use a trigger or PrismaService.transaction.
export interface OutboxPublishOptions {
  readonly eventOnly?: boolean;
}

@Injectable()
export class OutboxPublisher implements EventPublisherPort {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(private readonly prisma: PrismaService) {}

  async publish(event: DomainEvent, options?: OutboxPublishOptions): Promise<void> {
    await this.persist([event], options);
  }

  async publishAll(events: DomainEvent[], options?: OutboxPublishOptions): Promise<void> {
    if (events.length === 0) return;
    await this.persist(events, options);
  }

  private async persist(events: DomainEvent[], options?: OutboxPublishOptions): Promise<void> {
    // The tenant is taken from the event, not from the ambient request context: a handler may
    // legitimately publish for an organization other than the caller's active one, and reading CLS
    // here would silently overwrite that with the wrong tenant.
    const rows = events.map((event) => ({
      id: generateId(), // UUIDv7 — PK locality aligns with event ordering.
      organizationId: event.organizationId ?? null,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      payload: this.serializePayload(event),
    }));

    const transaction = this.prisma.currentTransaction;
    if (!transaction && options?.eventOnly !== true) {
      throw new Error(
        'Outbox writes must join the caller transaction; wrap this producer in prisma.transaction() ' +
          'or pass { eventOnly: true } when the write is intentionally event-only',
      );
    }

    try {
      const client = transaction ?? this.prisma.db;
      await client.outboxEvent.createMany({ data: rows });
    } catch (err) {
      this.logger.error({ err, eventCount: events.length }, 'Outbox persist failed');
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
