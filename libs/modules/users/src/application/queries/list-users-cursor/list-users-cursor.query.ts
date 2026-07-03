import { Query } from '@nestjs/cqrs';
import type { UserRole, UserStatus } from '../../../domain/entities/user.entity';
import type { UserListItemDto } from '../../dtos/user-list-item.dto';

export interface ListUsersCursorResult {
  data: UserListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

// Query<TResult> carries the result type so QueryBus.execute() infers it end-to-end.
export class ListUsersCursorQuery extends Query<ListUsersCursorResult> {
  constructor(
    readonly limit: number,
    readonly startingAfter?: string,
    readonly role?: UserRole,
    readonly status?: UserStatus,
    readonly search?: string,
  ) {
    super();
  }
}
