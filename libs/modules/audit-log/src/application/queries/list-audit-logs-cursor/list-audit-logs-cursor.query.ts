import { Query } from '@nestjs/cqrs';
import type { AuditLogListItemDto } from '../../dto/audit-log-list-item.dto';

export interface ListAuditLogsCursorResult {
  data: AuditLogListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListAuditLogsCursorFilters {
  readonly startingAfter?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly userId?: string;
  readonly occurredFrom?: Date;
  readonly occurredUntil?: Date;
}

export class ListAuditLogsCursorQuery extends Query<ListAuditLogsCursorResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly userId?: string;
  readonly occurredFrom?: Date;
  readonly occurredUntil?: Date;

  constructor(organizationId: string, limit: number, filters: ListAuditLogsCursorFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.action = filters.action;
    this.resource = filters.resource;
    this.userId = filters.userId;
    this.occurredFrom = filters.occurredFrom;
    this.occurredUntil = filters.occurredUntil;
  }
}
