import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, lastCursorOf, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { API_KEY_REPOSITORY, type ApiKeyRepositoryPort } from './api-key-repository.port';
import { toApiKeyDto, type ApiKeyDto } from './api-key.dto';

export interface ListApiKeysResult {
  data: ApiKeyDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListApiKeysFilters {
  readonly startingAfter?: string;
  readonly includeRevoked?: boolean;
}

export class ListApiKeysQuery extends Query<ListApiKeysResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly includeRevoked: boolean;

  constructor(organizationId: string, limit: number, filters: ListApiKeysFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.includeRevoked = filters.includeRevoked ?? false;
  }
}

@QueryHandler(ListApiKeysQuery)
export class ListApiKeysHandler implements IQueryHandler<ListApiKeysQuery, ListApiKeysResult> {
  constructor(@Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort) {}

  async execute(query: ListApiKeysQuery): Promise<ListApiKeysResult> {
    const { items, hasMore } = await this.apiKeys.findAllCursor({
      organizationId: query.organizationId,
      startingAfter: this.decodeStartingAfter(query.startingAfter),
      limit: query.limit,
      includeRevoked: query.includeRevoked,
    });

    const data: ApiKeyDto[] = items.map(toApiKeyDto);
    return { data, hasMore, lastCursor: lastCursorOf(items) };
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());
    return decoded;
  }
}
