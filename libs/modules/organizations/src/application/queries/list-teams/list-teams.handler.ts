import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { TEAM_REPOSITORY } from '../../../domain/ports/team-repository.port';
import type { TeamRepositoryPort } from '../../../domain/ports/team-repository.port';
import type { TeamDto } from '../../dto/organization-role.dto';
import { ListTeamsQuery, type ListTeamsResult } from './list-teams.query';

@QueryHandler(ListTeamsQuery)
export class ListTeamsHandler implements IQueryHandler<ListTeamsQuery, ListTeamsResult> {
  constructor(@Inject(TEAM_REPOSITORY) private readonly teams: TeamRepositoryPort) {}

  async execute(query: ListTeamsQuery): Promise<ListTeamsResult> {
    const { items, hasMore } = await this.teams.findAllCursor({
      organizationId: query.organizationId,
      startingAfter: this.decodeStartingAfter(query.startingAfter),
      limit: query.limit,
      search: query.search,
    });

    const data: TeamDto[] = items.map((team) => ({
      id: team.id,
      name: team.name,
      memberCount: team.memberCount,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
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
