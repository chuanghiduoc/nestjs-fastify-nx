import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';

// Mirrors what the `@db.Uuid` Postgres column accepts: the canonical 8-4-4-4-12
// hex layout, regardless of version/variant bits. Strictly enforcing version 1-7
// would reject otherwise valid ids that Postgres still happily stores, so we
// keep the regex aligned with the database parser rather than the IETF spec.
// The goal here is to turn caller bugs (`'evt-x'`, empty strings, accidental
// slugs) into a legible domain error instead of an opaque libpq parse error
// at write time — not to gate on RFC 4122 compliance.
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
  /** Deterministic id for idempotent writes (e.g. from outbox eventId). Defaults to generateId(). */
  id?: string;
  userId?: string | null;
  action: string;
  resource?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
}

/**
 * Append-only audit trail entry. Once created the entity is immutable —
 * the caller never mutates an existing log row, only appends new ones.
 */
export class AuditLog {
  private constructor(private readonly props: AuditLogProps) {}

  static create(input: CreateAuditLogInput): AuditLog {
    // Reject empty-string and non-UUID ids up front so callers see a domain
    // error instead of a Prisma/libpq UUID parse error at write time.
    if (input.id !== undefined) {
      if (input.id.trim() === '') {
        throw new BusinessRuleException({
          code: 'invalid_audit_log_id',
          title: 'Invalid AuditLog id',
          violations: [
            {
              path: 'id',
              code: 'empty_string',
              message: 'id must be a non-empty string when provided',
            },
          ],
        });
      }
      if (!UUID_PATTERN.test(input.id)) {
        throw new BusinessRuleException({
          code: 'invalid_audit_log_id',
          title: 'Invalid AuditLog id',
          violations: [
            {
              path: 'id',
              code: 'not_a_uuid',
              message: 'id must be a valid UUID (audit_logs.id is a Postgres UUID column)',
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
