import type { Permission } from '@nestjs-fastify-nx/shared';

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
