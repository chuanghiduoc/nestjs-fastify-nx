import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(AuditLogListener.name);

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

    try {
      await this.repository.append(entry);
    } catch (err) {
      this.logger.error(
        `Audit listener failed for event ${event.eventType} (id=${event.eventId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
