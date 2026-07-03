import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { encodeCursor } from '@nestjs-fastify-nx/shared';
import { USER_REPOSITORY_PORT } from '../../../domain/ports/user-repository.port';
import type { UserRepositoryPort } from '../../../domain/ports/user-repository.port';
import type { UserListItemDto } from '../../dtos/user-list-item.dto';
import { ListUsersCursorQuery, type ListUsersCursorResult } from './list-users-cursor.query';

@QueryHandler(ListUsersCursorQuery)
export class ListUsersCursorHandler implements IQueryHandler<
  ListUsersCursorQuery,
  ListUsersCursorResult
> {
  constructor(@Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort) {}

  async execute(query: ListUsersCursorQuery): Promise<ListUsersCursorResult> {
    const { items, hasMore } = await this.users.findAllCursor({
      startingAfter: query.startingAfter,
      limit: query.limit,
      role: query.role,
      status: query.status,
      search: query.search,
    });

    const data: UserListItemDto[] = items.map((user) => ({
      id: user.id,
      email: user.email.toString(),
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    const lastItem = items[items.length - 1];
    const lastCursor = lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    return { data, hasMore, lastCursor };
  }
}
