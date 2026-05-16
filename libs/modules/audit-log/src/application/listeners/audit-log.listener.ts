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

/**
 * Listens to all `users.*` domain events and persists an immutable audit
 * trail. Wildcard subscription is enabled by `wildcard: true` in
 * MessagingModule (`EventEmitterModule.forRoot`).
 */
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
      userId: event.aggregateId,
      action: event.eventType,
      resource: 'user',
      metadata: { ...metadata, eventId: event.eventId },
      ipAddress: typeof ip === 'string' ? ip : null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      occurredAt: event.occurredAt,
    });

    // Intentionally not catching: EventEmitter2 is configured with
    // `ignoreErrors: false`, so a thrown error propagates back to the caller of
    // `EventBusService.publish` (typically a CQRS command handler). Under the
    // outbox driver, the relay additionally marks `lastError` on the outbox row;
    // under the default in-process driver the rejection aborts the command handler.
    await this.repository.append(entry);
  }
}
