import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { RecordAuditLogCommand } from '../commands/record-audit-log/record-audit-log.command';

interface AuditPayload extends Record<string, unknown> {
  ip?: string;
  userAgent?: string;
}

function isAuditPayload(value: unknown): value is AuditPayload {
  return typeof value === 'object' && value !== null;
}

@Injectable()
export class AuditLogListener {
  constructor(private readonly commandBus: CommandBus) {}

  @OnEvent('users.*', { async: true, promisify: true })
  async handleUserEvent(event: DomainEvent): Promise<void> {
    const payload = isAuditPayload(event.payload) ? event.payload : {};
    const { ip, userAgent, ...metadata } = payload;

    // Errors propagate to EventBusService.publish; outbox relay marks lastError, in-process aborts the handler.
    await this.commandBus.execute(
      new RecordAuditLogCommand(
        event.eventId,
        event.aggregateId,
        event.eventType,
        'user',
        { ...metadata, eventId: event.eventId },
        typeof ip === 'string' ? ip : null,
        typeof userAgent === 'string' ? userAgent : null,
        event.occurredAt,
      ),
    );
  }
}
