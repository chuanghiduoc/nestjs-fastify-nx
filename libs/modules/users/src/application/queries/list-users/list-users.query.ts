import type { UserRole, UserStatus } from '../../../domain/entities/user.entity';

export class ListUsersQuery {
  constructor(
    readonly page: number,
    readonly pageSize: number,
    readonly role?: UserRole,
    readonly status?: UserStatus,
    readonly search?: string,
  ) {}
}
