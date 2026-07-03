import { Query } from '@nestjs/cqrs';
import type { UserRole, UserStatus } from '../../../domain/entities/user.entity';

export interface UserProfileResult {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Query<TResult> carries the result type so QueryBus.execute() infers it end-to-end.
export class GetUserProfileQuery extends Query<UserProfileResult> {
  constructor(readonly userId: string) {
    super();
  }
}
