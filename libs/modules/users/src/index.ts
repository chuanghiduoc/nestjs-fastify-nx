export { UsersModule } from './users.module';
export { UsersListenersModule } from './users-listeners.module';

// Enums used by consumers (scheduler, GraphQL type registration)
export { UserRole, UserStatus } from './domain/entities/user.entity';

// Query handlers + queries exposed for DI injection in cross-cutting resolvers.
export { GetUserProfileHandler } from './application/queries/get-user-profile/get-user-profile.handler';
export { GetUserProfileQuery } from './application/queries/get-user-profile/get-user-profile.query';
export type { UserProfileResult } from './application/queries/get-user-profile/get-user-profile.handler';
export { ListUsersCursorHandler } from './application/queries/list-users-cursor/list-users-cursor.handler';
export type { ListUsersCursorResult } from './application/queries/list-users-cursor/list-users-cursor.handler';
export { ListUsersCursorQuery } from './application/queries/list-users-cursor/list-users-cursor.query';
export type { UserListItemDto } from './application/dtos/user-list-item.dto';

// Public presentation types
export { ListUsersCursorFilterDto } from './presentation/dto/list-users-cursor-filter.dto';
export {
  UserListItemResponseDto,
  UserProfileResponseDto,
} from './presentation/dto/auth-response.dto';
