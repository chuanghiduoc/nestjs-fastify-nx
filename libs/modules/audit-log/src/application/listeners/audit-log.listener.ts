import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENT_STREAMS } from '@nestjs-fastify-nx/shared';
import { RecordAuditLogCommand } from '../commands/record-audit-log/record-audit-log.command';

@Injectable()
export class AuditLogListener {
  constructor(private readonly commandBus: CommandBus) {}

  // Audit records every users.* event, including ones whose payload this context does not model —
  // unknown keys pass through into metadata rather than being validated away.
  @OnEvent(DOMAIN_EVENT_STREAMS.USERS, { async: true, promisify: true, suppressErrors: false })
  async handleUserEvent(event: DomainEvent): Promise<void> {
    const { ip, userAgent, ...metadata } = event.payload;

    // Errors propagate to EventBusService.publish; outbox relay marks lastError, in-process aborts the handler.
    await this.commandBus.execute(
      new RecordAuditLogCommand(
        event.eventId,
        event.organizationId ?? null,
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

  // On this stream `aggregateId` is the organization, and the acting member (when there is one)
  // travels in the payload — so userId comes from there rather than from the aggregate.
  @OnEvent(DOMAIN_EVENT_STREAMS.ORGANIZATIONS, {
    async: true,
    promisify: true,
    suppressErrors: false,
  })
  async handleOrganizationEvent(event: DomainEvent): Promise<void> {
    const { userId: memberUserId, ...metadata } = event.payload;

    await this.commandBus.execute(
      new RecordAuditLogCommand(
        event.eventId,
        event.organizationId ?? event.aggregateId,
        null,
        event.eventType,
        'organization',
        {
          ...metadata,
          ...(typeof memberUserId === 'string' ? { memberUserId } : {}),
          eventId: event.eventId,
          organizationId: event.aggregateId,
        },
        null,
        null,
        event.occurredAt,
      ),
    );
  }
}
