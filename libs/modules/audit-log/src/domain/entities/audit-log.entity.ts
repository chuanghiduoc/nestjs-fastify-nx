import { generateId } from '@nestjs-fastify-nx/shared';

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
    return new AuditLog({
      id: generateId(),
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
