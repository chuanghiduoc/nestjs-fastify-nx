import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { SESSION_REPOSITORY } from '../../../domain/ports/session-repository.port';
import type { SessionRepositoryPort } from '../../../domain/ports/session-repository.port';
import type { SessionDto } from '../../dto/session.dto';
import { ListMySessionsQuery, type ListMySessionsResult } from './list-my-sessions.query';

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

    const lastItem = items[items.length - 1];
    return {
      data,
      hasMore,
      lastCursor: lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null,
    };
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());
    return decoded;
  }
}
