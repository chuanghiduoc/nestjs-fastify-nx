import { HttpStatus, Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
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
      startingAfter: this.decodeStartingAfter(query.startingAfter),
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

  // Decoding here — rather than in the repository — keeps the cursor string at the boundary that
  // owns input validation, so every UserRepositoryPort implementation receives a cursor that
  // cannot be malformed.
  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;

    const decoded = decodeCursor(raw);
    if (!decoded) {
      throw new BusinessRuleException({
        status: HttpStatus.BAD_REQUEST,
        // BusinessRuleException titles itself "Business rule violation" by default, which only reads
        // correctly for its default 422. Non-422 callers must pass the status-appropriate key.
        title: I18N_KEYS.common.bad_request,
        code: 'invalid_cursor',
        messageKey: I18N_KEYS.errors.pagination.invalid_cursor,
        violations: [
          {
            path: 'startingAfter',
            code: 'invalid_cursor',
            message: 'startingAfter is not a valid cursor',
            messageKey: I18N_KEYS.errors.pagination.invalid_cursor,
          },
        ],
      });
    }

    return decoded;
  }
}
