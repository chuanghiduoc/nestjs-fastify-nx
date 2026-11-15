import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, lastCursorOf, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from './session-repository.port';

export interface SessionDto {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListMySessionsResult {
  data: SessionDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListMySessionsFilters {
  readonly startingAfter?: string;
  readonly activeOnly?: boolean;
}

export class ListMySessionsQuery extends Query<ListMySessionsResult> {
  readonly userId: string;
  readonly currentSessionId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly activeOnly: boolean;

  constructor(
    userId: string,
    currentSessionId: string,
    limit: number,
    filters: ListMySessionsFilters = {},
  ) {
    super();
    this.userId = userId;
    this.currentSessionId = currentSessionId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.activeOnly = filters.activeOnly ?? true;
  }
}

@QueryHandler(ListMySessionsQuery)
export class ListMySessionsHandler implements IQueryHandler<
  ListMySessionsQuery,
  ListMySessionsResult
> {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort) {}

  async execute(query: ListMySessionsQuery): Promise<ListMySessionsResult> {
    const { items, hasMore } = await this.sessions.findAllCursor({
      userId: query.userId,
      startingAfter: this.decodeStartingAfter(query.startingAfter),
      limit: query.limit,
      activeOnly: query.activeOnly,
      now: new Date(),
    });

    // The session token itself is never projected: it is the bearer credential, and a listing that
    // returned it would let one compromised response hand over every other device.
    const data: SessionDto[] = items.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      current: session.id === query.currentSessionId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
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
