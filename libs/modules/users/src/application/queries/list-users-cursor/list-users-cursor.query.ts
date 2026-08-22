import { Query } from '@nestjs/cqrs';
import type { UserStatus } from '../../../domain/entities/user.entity';
import type { UserListItemDto } from '../../dto/user-list-item.dto';

export interface ListUsersCursorResult {
  data: UserListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

// Query<TResult> carries the result type so QueryBus.execute() infers it end-to-end.
export class ListUsersCursorQuery extends Query<ListUsersCursorResult> {
  constructor(
    readonly organizationId: string,
    readonly limit: number,
    readonly startingAfter?: string,
    readonly role?: string,
    readonly status?: UserStatus,
    readonly search?: string,
  ) {
    super();
  }
}
