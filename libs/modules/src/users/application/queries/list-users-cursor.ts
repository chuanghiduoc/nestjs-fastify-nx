import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, lastCursorOf, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import {
  USER_REPOSITORY_PORT,
  type UserRepositoryPort,
} from '../../domain/ports/user-repository.port';
import type { UserStatus } from '../../domain/entities/user.entity';
import type { UserListItemDto } from '../dto/user-list-item.dto';

export interface ListUsersCursorResult {
  data: UserListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListUsersCursorFilters {
  readonly startingAfter?: string;
  readonly role?: string;
  readonly status?: UserStatus;
  readonly search?: string;
}

export class ListUsersCursorQuery extends Query<ListUsersCursorResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly role?: string;
  readonly status?: UserStatus;
  readonly search?: string;

  constructor(organizationId: string, limit: number, filters: ListUsersCursorFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.role = filters.role;
    this.status = filters.status;
    this.search = filters.search;
  }
}

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

    return { data, hasMore, lastCursor: lastCursorOf(items) };
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());
    return decoded;
  }
}
