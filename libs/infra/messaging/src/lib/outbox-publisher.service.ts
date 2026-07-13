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

    try {
      const client = this.prisma.currentTransaction ?? this.prisma.db;
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
