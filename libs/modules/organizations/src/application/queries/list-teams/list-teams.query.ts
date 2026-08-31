import { Query } from '@nestjs/cqrs';
import type { TeamDto } from '../../dto/organization-role.dto';

export interface ListTeamsResult {
  data: TeamDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListTeamsFilters {
  readonly startingAfter?: string;
  readonly search?: string;
}

export class ListTeamsQuery extends Query<ListTeamsResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly search?: string;

  constructor(organizationId: string, limit: number, filters: ListTeamsFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.search = filters.search;
  }
}
