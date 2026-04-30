import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { GetUserProfileQuery } from './get-user-profile.query';
import { USER_REPOSITORY_PORT } from '../../../domain/ports/user-repository.port';
import type { UserRepositoryPort } from '../../../domain/ports/user-repository.port';
import type { UserProfileDto } from '../../dtos/user-profile.dto';

@Injectable()
export class GetUserProfileHandler {
  constructor(@Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort) {}

  async execute(query: GetUserProfileQuery): Promise<UserProfileDto> {
    const user = await this.users.findById(query.userId);
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      email: user.email.toString(),
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
