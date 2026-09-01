import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagDto } from '../../dto/feature-flag.dto';
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

    const data: FeatureFlagDto[] = items.map((flag) => ({
      id: flag.id,
      key: flag.key,
      description: flag.description,
      enabled: flag.enabled,
      rolloutPercentage: flag.rolloutPercentage,
      createdAt: flag.createdAt,
      updatedAt: flag.updatedAt,
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
