import { paginateNewestFirst } from '@nestjs-fastify-nx/shared';
import type {
  AuditLogRepositoryPort,
  FindAuditLogsCursorOptions,
  FindAuditLogsCursorResult,
} from '../domain/ports/audit-log-repository.port';
import type { AuditLog } from '../domain/entities/audit-log.entity';

export class MockAuditLogRepository implements AuditLogRepositoryPort {
  private readonly entries = new Map<string, AuditLog>();

  append(entry: AuditLog): Promise<void> {
    if (!this.entries.has(entry.id)) this.entries.set(entry.id, entry);
    return Promise.resolve();
  }

  findAllCursor(options: FindAuditLogsCursorOptions): Promise<FindAuditLogsCursorResult> {
    const matching = [...this.entries.values()].filter((entry) => this.matches(entry, options));

    return Promise.resolve(
      paginateNewestFirst(matching, {
        startingAfter: options.startingAfter,
        limit: options.limit,
      }),
    );
  }

  clear(): void {
    this.entries.clear();
  }

  private matches(entry: AuditLog, options: FindAuditLogsCursorOptions): boolean {
    if (entry.organizationId !== options.organizationId) return false;
    if (options.action && entry.action !== options.action) return false;
    if (options.resource && entry.resource !== options.resource) return false;
    if (options.userId && entry.userId !== options.userId) return false;
    if (options.occurredFrom && entry.createdAt.getTime() < options.occurredFrom.getTime()) {
      return false;
    }
    if (options.occurredUntil && entry.createdAt.getTime() > options.occurredUntil.getTime()) {
      return false;
    }
    return true;
  }
}
