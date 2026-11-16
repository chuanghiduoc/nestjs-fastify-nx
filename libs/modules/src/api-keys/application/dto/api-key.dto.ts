import type { Permission } from '@nestjs-fastify-nx/shared';
import type { ApiKey } from '../../domain/entities/api-key.entity';

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  scopes: readonly Permission[];
  createdById: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface IssuedApiKeyDto extends ApiKeyDto {
  /** Returned exactly once, at creation. Never retrievable afterwards. */
  key: string;
}

// `keyHash` is deliberately absent: the digest is the only stored form of the secret and nothing
// outside verification ever needs it.
export function toApiKeyDto(apiKey: ApiKey): ApiKeyDto {
  return {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    scopes: apiKey.scopes,
    createdById: apiKey.createdById,
    lastUsedAt: apiKey.lastUsedAt,
    expiresAt: apiKey.expiresAt,
    revokedAt: apiKey.revokedAt,
    createdAt: apiKey.createdAt,
  };
}
