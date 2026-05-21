import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { AUDIT_LOG_REPOSITORY_PORT } from '../../domain/ports/audit-log-repository.port';
import type { AuditLogRepositoryPort } from '../../domain/ports/audit-log-repository.port';
import { AuditLog } from '../../domain/entities/audit-log.entity';

interface AuditPayload extends Record<string, unknown> {
  ip?: string;
  userAgent?: string;
}

function isAuditPayload(value: unknown): value is AuditPayload {
  return typeof value === 'object' && value !== null;
}

@Injectable()
export class AuditLogListener {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY_PORT) private readonly repository: AuditLogRepositoryPort,
  ) {}

  @OnEvent('users.*', { async: true, promisify: true })
  async handleUserEvent(event: DomainEvent): Promise<void> {
    const payload = isAuditPayload(event.payload) ? event.payload : {};
    const { ip, userAgent, ...metadata } = payload;

    const entry = AuditLog.create({
      // Derive id from eventId so outbox redelivery produces the same PK; repository treats P2002 as no-op.
      id: event.eventId,
      userId: event.aggregateId,
      action: event.eventType,
      resource: 'user',
      metadata: { ...metadata, eventId: event.eventId },
      ipAddress: typeof ip === 'string' ? ip : null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      occurredAt: event.occurredAt,
    });

    // Errors propagate to EventBusService.publish; outbox relay marks lastError, in-process aborts the handler.
    await this.repository.append(entry);
  }
}
