import { HttpStatus, Injectable, Inject } from '@nestjs/common';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { GetUserProfileQuery } from './get-user-profile.query';
import { USER_REPOSITORY_PORT } from '../../../domain/ports/user-repository.port';
import type { UserRepositoryPort } from '../../../domain/ports/user-repository.port';
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

@Injectable()
export class GetUserProfileHandler {
  constructor(@Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort) {}

  async execute(query: GetUserProfileQuery): Promise<UserProfileResult> {
    const user = await this.users.findById(query.userId);
    if (!user) {
      throw new BusinessRuleException({
        status: HttpStatus.NOT_FOUND,
        code: 'user_not_found',
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
