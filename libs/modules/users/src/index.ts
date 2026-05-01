export { UsersModule } from './users.module';
export { UsersListenersModule } from './users-listeners.module';

export { User, UserRole, UserStatus } from './domain/entities/user.entity';
export { Email } from './domain/value-objects/email.vo';
export { USER_REPOSITORY_PORT } from './domain/ports/user-repository.port';
export type {
  UserRepositoryPort,
  FindAllOptions,
  FindAllResult,
} from './domain/ports/user-repository.port';

export { ListUsersHandler } from './application/queries/list-users/list-users.handler';
export { ListUsersQuery } from './application/queries/list-users/list-users.query';
export type { UserListItemDto } from './application/dtos/user-list-item.dto';
export { ListUsersFilterDto } from './presentation/dto/list-users-filter.dto';
export {
  UserListItemResponseDto,
  UserProfileResponseDto,
} from './presentation/dto/auth-response.dto';

export { UserRegistered } from './domain/events/user-registered.event';
export type { UserRegisteredPayload } from './domain/events/user-registered.event';

export { CurrentUser } from './presentation/decorators/current-user.decorator';
export type { AuthenticatedUser } from './presentation/types/authenticated-user.type';
