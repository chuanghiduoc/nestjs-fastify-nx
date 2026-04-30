import type { UserRole, UserStatus } from '../../../domain/entities/user.entity';

export class ListUsersQuery {
  constructor(
    readonly page: number,
    readonly limit: number,
    readonly role?: UserRole,
    readonly status?: UserStatus,
    readonly search?: string,
  ) {}
}
