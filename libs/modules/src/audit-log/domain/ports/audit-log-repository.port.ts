import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { AuditLog } from '../entities/audit-log.entity';

export const AUDIT_LOG_REPOSITORY_PORT = Symbol('AuditLogRepositoryPort');

export interface FindAuditLogsCursorOptions {
  organizationId: string;
  startingAfter?: DecodedCursor;
  limit: number;
  action?: string;
  resource?: string;
  userId?: string;
  occurredFrom?: Date;
  occurredUntil?: Date;
}

export interface FindAuditLogsCursorResult {
  items: AuditLog[];
  hasMore: boolean;
}

export interface AuditLogRepositoryPort {
  /**
   * Persist a single audit entry. Implementations must be append-only —
   * never update or delete existing rows.
   */
  append(entry: AuditLog): Promise<void>;

  findAllCursor(options: FindAuditLogsCursorOptions): Promise<FindAuditLogsCursorResult>;
}
