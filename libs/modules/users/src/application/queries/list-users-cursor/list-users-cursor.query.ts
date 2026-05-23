import type { UserRole, UserStatus } from '../../../domain/entities/user.entity';

export class ListUsersCursorQuery {
  constructor(
    readonly limit: number,
    readonly startingAfter?: string,
    readonly role?: UserRole,
    readonly status?: UserStatus,
    readonly search?: string,
  ) {}
}
