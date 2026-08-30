import { Query } from '@nestjs/cqrs';
import type { UserStatus } from '../../../domain/entities/user.entity';
import type { UserListItemDto } from '../../dto/user-list-item.dto';

export interface ListUsersCursorResult {
  data: UserListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListUsersCursorFilters {
  readonly startingAfter?: string;
  readonly role?: string;
  readonly status?: UserStatus;
  readonly search?: string;
}

export class ListUsersCursorQuery extends Query<ListUsersCursorResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly role?: string;
  readonly status?: UserStatus;
  readonly search?: string;

  constructor(organizationId: string, limit: number, filters: ListUsersCursorFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.role = filters.role;
    this.status = filters.status;
    this.search = filters.search;
  }
}
