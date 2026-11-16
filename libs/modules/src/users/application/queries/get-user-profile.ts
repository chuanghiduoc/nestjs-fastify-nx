import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { I18N_KEYS, ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import {
  USER_REPOSITORY_PORT,
  type UserRepositoryPort,
} from '../../domain/ports/user-repository.port';
import type { UserRole, UserStatus } from '../../domain/entities/user.entity';

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

@QueryHandler(GetUserProfileQuery)
export class GetUserProfileHandler implements IQueryHandler<
  GetUserProfileQuery,
  UserProfileResult
> {
  constructor(@Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort) {}

  async execute(query: GetUserProfileQuery): Promise<UserProfileResult> {
    const user = await this.users.findById(query.userId);
    if (!user) {
      throw new DomainException({
        kind: 'not_found',
        // Without this the response titles a 404 "Business rule violation" — the class default only
        // fits a rule violation — and the literal skips i18n because it isn't a dotted key.
        title: I18N_KEYS.common.not_found,
        code: ERROR_CODES.USER_NOT_FOUND,
        messageKey: I18N_KEYS.errors.users.not_found,
        violations: [
          {
            path: 'userId',
            code: 'not_found',
            message: 'User not found',
            messageKey: I18N_KEYS.errors.users.not_found,
          },
        ],
      });
    }

    return {
      id: user.id,
      email: user.email.toString(),
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
