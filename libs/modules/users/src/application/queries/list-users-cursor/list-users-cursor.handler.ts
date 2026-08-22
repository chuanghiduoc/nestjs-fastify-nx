import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { I18N_KEYS, ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { USER_REPOSITORY_PORT } from '../../../domain/ports/user-repository.port';
import type { UserRepositoryPort } from '../../../domain/ports/user-repository.port';
import type { UserListItemDto } from '../../dto/user-list-item.dto';
import { ListUsersCursorQuery, type ListUsersCursorResult } from './list-users-cursor.query';

@QueryHandler(ListUsersCursorQuery)
export class ListUsersCursorHandler implements IQueryHandler<
  ListUsersCursorQuery,
  ListUsersCursorResult
> {
  constructor(@Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort) {}

  async execute(query: ListUsersCursorQuery): Promise<ListUsersCursorResult> {
    const { items, hasMore } = await this.users.findAllCursor({
      organizationId: query.organizationId,
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
      role: user.organizationRole ?? '',
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
      throw new DomainException({
        kind: 'malformed',
        // The default title only reads correctly for a rule violation; a malformed cursor needs the
        // status-appropriate key.
        title: I18N_KEYS.common.bad_request,
        code: ERROR_CODES.INVALID_CURSOR,
        messageKey: I18N_KEYS.errors.pagination.invalid_cursor,
        violations: [
          {
            path: 'startingAfter',
            code: ERROR_CODES.INVALID_CURSOR,
            message: 'startingAfter is not a valid cursor',
            messageKey: I18N_KEYS.errors.pagination.invalid_cursor,
          },
        ],
      });
    }

    return decoded;
  }
}
