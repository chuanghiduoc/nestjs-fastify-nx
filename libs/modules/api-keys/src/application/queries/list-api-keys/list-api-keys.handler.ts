import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { API_KEY_REPOSITORY } from '../../../domain/ports/api-key-repository.port';
import type { ApiKeyRepositoryPort } from '../../../domain/ports/api-key-repository.port';
import type { ApiKeyDto } from '../../dto/api-key.dto';
import { ListApiKeysQuery, type ListApiKeysResult } from './list-api-keys.query';

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

    // `keyHash` is deliberately absent: the digest is the only stored form of the secret and
    // nothing outside verification ever needs it.
    const data: ApiKeyDto[] = items.map((apiKey) => ({
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      createdById: apiKey.createdById,
      lastUsedAt: apiKey.lastUsedAt,
      expiresAt: apiKey.expiresAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
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
