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
    const matching = [...this.entries.values()]
      .filter((entry) => this.matches(entry, options))
      .sort(compareNewestFirst);

    const cursor = options.startingAfter;
    const afterCursor = cursor ? matching.filter((entry) => isBefore(entry, cursor)) : matching;

    return Promise.resolve({
      items: afterCursor.slice(0, options.limit),
      hasMore: afterCursor.length > options.limit,
    });
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

function compareNewestFirst(left: AuditLog, right: AuditLog): number {
  const byDate = right.createdAt.getTime() - left.createdAt.getTime();
  return byDate !== 0 ? byDate : right.id.localeCompare(left.id);
}

function isBefore(entry: AuditLog, cursor: { createdAt: Date; id: string }): boolean {
  const entryTime = entry.createdAt.getTime();
  const cursorTime = cursor.createdAt.getTime();
  if (entryTime !== cursorTime) return entryTime < cursorTime;
  return entry.id.localeCompare(cursor.id) < 0;
}
