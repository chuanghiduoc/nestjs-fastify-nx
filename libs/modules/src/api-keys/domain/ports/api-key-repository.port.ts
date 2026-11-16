import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { ApiKey } from '../entities/api-key.entity';

export const API_KEY_REPOSITORY = Symbol('API_KEY_REPOSITORY');

export interface FindApiKeysCursorOptions {
  organizationId: string;
  startingAfter?: DecodedCursor;
  limit: number;
  includeRevoked: boolean;
}

export interface FindApiKeysCursorResult {
  items: ApiKey[];
  hasMore: boolean;
}

export interface ApiKeyRepositoryPort {
  findAllCursor(options: FindApiKeysCursorOptions): Promise<FindApiKeysCursorResult>;
  create(apiKey: ApiKey): Promise<void>;
  /** Compare-and-set from live to revoked; false when the key was missing or already revoked. */
  revoke(organizationId: string, id: string, revokedAt: Date): Promise<boolean>;
  exists(organizationId: string, id: string): Promise<boolean>;
}
