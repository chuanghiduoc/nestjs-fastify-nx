import { Query } from '@nestjs/cqrs';
import type { SessionDto } from '../../dto/session.dto';

export interface ListMySessionsResult {
  data: SessionDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListMySessionsFilters {
  readonly startingAfter?: string;
  readonly activeOnly?: boolean;
}

export class ListMySessionsQuery extends Query<ListMySessionsResult> {
  readonly userId: string;
  readonly currentSessionId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly activeOnly: boolean;

  constructor(
    userId: string,
    currentSessionId: string,
    limit: number,
    filters: ListMySessionsFilters = {},
  ) {
    super();
    this.userId = userId;
    this.currentSessionId = currentSessionId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.activeOnly = filters.activeOnly ?? true;
  }
}
