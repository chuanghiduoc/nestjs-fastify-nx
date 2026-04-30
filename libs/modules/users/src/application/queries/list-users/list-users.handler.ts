import { Inject, Injectable } from '@nestjs/common';
import { buildPageMeta, type Page } from '@nestjs-fastify-nx/shared';
import { USER_REPOSITORY_PORT } from '../../../domain/ports/user-repository.port';
import type { UserRepositoryPort } from '../../../domain/ports/user-repository.port';
import type { UserListItemDto } from '../../dtos/user-list-item.dto';
import { ListUsersQuery } from './list-users.query';

@Injectable()
export class ListUsersHandler {
  constructor(@Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort) {}

  async execute(query: ListUsersQuery): Promise<Page<UserListItemDto>> {
    const { items, total } = await this.users.findAll({
      page: query.page,
      limit: query.limit,
      role: query.role,
      status: query.status,
      search: query.search,
    });

    return {
      data: items.map((user) => ({
        id: user.id,
        email: user.email.toString(),
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
      meta: buildPageMeta(query.page, query.limit, total),
    };
  }
}
