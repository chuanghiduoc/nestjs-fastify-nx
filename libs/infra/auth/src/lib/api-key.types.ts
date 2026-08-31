import type { Permission } from '@nestjs-fastify-nx/shared';

export interface AuthenticatedApiKey {
  readonly apiKeyId: string;
  readonly organizationId: string;
  readonly scopes: readonly Permission[];
}
