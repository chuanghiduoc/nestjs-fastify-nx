import type { AuditLog } from '../entities/audit-log.entity';

export const AUDIT_LOG_REPOSITORY_PORT = Symbol('AuditLogRepositoryPort');

export interface AuditLogRepositoryPort {
  /**
   * Persist a single audit entry. Implementations must be append-only —
   * never update or delete existing rows.
   */
  append(entry: AuditLog): Promise<void>;
}
