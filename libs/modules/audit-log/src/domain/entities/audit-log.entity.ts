import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { generateId } from '@nestjs-fastify-nx/shared';

// Mirrors what Postgres @db.Uuid accepts (8-4-4-4-12 hex, any version/variant).
// Goal: turn caller bugs (empty string, slug) into a legible domain error instead of an opaque libpq parse error.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditLogProps {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  /** Deterministic id for idempotent writes (e.g. outbox eventId). Defaults to generateId(). */
  id?: string;
  userId?: string | null;
  action: string;
  resource?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
}

export class AuditLog {
  private constructor(private readonly props: AuditLogProps) {}

  static create(input: CreateAuditLogInput): AuditLog {
    if (input.id !== undefined) {
      if (input.id.trim() === '') {
        throw new BusinessRuleException({
          code: 'invalid_audit_log_id',
          title: I18N_KEYS.errors.audit_log.title_invalid_id,
          violations: [
            {
              path: 'id',
              code: 'empty_string',
              message: 'id must be a non-empty string when provided',
              messageKey: I18N_KEYS.errors.audit_log.invalid_id_empty,
            },
          ],
        });
      }
      if (!UUID_PATTERN.test(input.id)) {
        throw new BusinessRuleException({
          code: 'invalid_audit_log_id',
          title: I18N_KEYS.errors.audit_log.title_invalid_id,
          violations: [
            {
              path: 'id',
              code: 'not_a_uuid',
              message: 'id must be a valid UUID (audit_logs.id is a Postgres UUID column)',
              messageKey: I18N_KEYS.errors.audit_log.invalid_id_uuid,
            },
          ],
        });
      }
    }
    return new AuditLog({
      id: input.id ?? generateId(),
      userId: input.userId ?? null,
      action: input.action,
      resource: input.resource ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: input.occurredAt ?? new Date(),
    });
  }

  static reconstitute(raw: AuditLogProps): AuditLog {
    return new AuditLog(raw);
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string | null {
    return this.props.userId;
  }
  get action(): string {
    return this.props.action;
  }
  get resource(): string | null {
    return this.props.resource;
  }
  get metadata(): Record<string, unknown> {
    return this.props.metadata;
  }
  get ipAddress(): string | null {
    return this.props.ipAddress;
  }
  get userAgent(): string | null {
    return this.props.userAgent;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
