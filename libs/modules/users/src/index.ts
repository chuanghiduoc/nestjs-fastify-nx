export { UsersModule } from './users.module';
export { UsersListenersModule } from './users-listeners.module';

// Enums used by consumers (scheduler, GraphQL type registration)
export { UserRole, UserStatus } from './domain/entities/user.entity';

// Query handlers + queries exposed for DI injection in cross-cutting resolvers.
// Removing these would require refactoring user.resolver.ts + admin controller
// (> 5 production files) — deferred to Phase 4/5.
export { GetUserProfileHandler } from './application/queries/get-user-profile/get-user-profile.handler';
export { GetUserProfileQuery } from './application/queries/get-user-profile/get-user-profile.query';
export type { UserProfileResult } from './application/queries/get-user-profile/get-user-profile.handler';
export { ListUsersHandler } from './application/queries/list-users/list-users.handler';
export { ListUsersQuery } from './application/queries/list-users/list-users.query';
export type { UserListItemDto } from './application/dtos/user-list-item.dto';

// Public presentation types
export { ListUsersFilterDto } from './presentation/dto/list-users-filter.dto';
export {
  UserListItemResponseDto,
  UserProfileResponseDto,
} from './presentation/dto/auth-response.dto';
