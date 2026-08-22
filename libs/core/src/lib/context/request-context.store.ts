import type { ClsStore } from 'nestjs-cls';

// Seeded once per request (see apps/api LoggingModule + BetterAuthGuard) and read back
// anywhere in the async call chain — pino mixin, Sentry tagging, CQRS instrumentation —
// without threading these values through every function signature.
export type PrincipalType = 'user' | 'api_key' | 'system';

export interface RequestContextStore extends ClsStore {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  organizationId?: string;
  principalType?: PrincipalType;
}

export const REQUEST_CONTEXT_KEYS = {
  requestId: 'requestId',
  correlationId: 'correlationId',
  userId: 'userId',
  organizationId: 'organizationId',
  principalType: 'principalType',
} as const;
