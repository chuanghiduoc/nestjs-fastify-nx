import { Query } from '@nestjs/cqrs';
import type { ApiKeyDto } from '../../dto/api-key.dto';

export interface ListApiKeysResult {
  data: ApiKeyDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListApiKeysFilters {
  readonly startingAfter?: string;
  readonly includeRevoked?: boolean;
}

export class ListApiKeysQuery extends Query<ListApiKeysResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly includeRevoked: boolean;

  constructor(organizationId: string, limit: number, filters: ListApiKeysFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.includeRevoked = filters.includeRevoked ?? false;
  }
}
