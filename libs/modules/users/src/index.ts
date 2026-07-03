export { UsersModule } from './users.module';
export { UsersListenersModule } from './users-listeners.module';

// Enums used by consumers (scheduler, GraphQL type registration)
export { UserRole, UserStatus } from './domain/entities/user.entity';

// Queries + result types exposed so cross-cutting consumers (GraphQL resolver, admin
// composition) can dispatch through the QueryBus. Handlers stay internal — registered
// with the global bus by CqrsModule's explorer, never injected directly.
export {
  GetUserProfileQuery,
  type UserProfileResult,
} from './application/queries/get-user-profile/get-user-profile.query';
export {
  ListUsersCursorQuery,
  type ListUsersCursorResult,
} from './application/queries/list-users-cursor/list-users-cursor.query';
export type { UserListItemDto } from './application/dtos/user-list-item.dto';

// Public presentation types
export { ListUsersCursorFilterDto } from './presentation/dto/list-users-cursor-filter.dto';
export {
  UserListItemResponseDto,
  UserProfileResponseDto,
} from './presentation/dto/auth-response.dto';
