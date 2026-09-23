import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, lastCursorOf, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import { toFeatureFlagDto, type FeatureFlagDto } from '../../dto/feature-flag.dto';
import { ListFeatureFlagsQuery, type ListFeatureFlagsResult } from './list-feature-flags.query';

@QueryHandler(ListFeatureFlagsQuery)
export class ListFeatureFlagsHandler implements IQueryHandler<
  ListFeatureFlagsQuery,
  ListFeatureFlagsResult
> {
  constructor(@Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort) {}

  async execute(query: ListFeatureFlagsQuery): Promise<ListFeatureFlagsResult> {
    const { items, hasMore } = await this.flags.findAllCursor({
      organizationId: query.organizationId,
      startingAfter: this.decodeStartingAfter(query.startingAfter),
      limit: query.limit,
    });

    const data: FeatureFlagDto[] = items.map(toFeatureFlagDto);

    return { data, hasMore, lastCursor: lastCursorOf(items) };
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());
    return decoded;
  }
}
