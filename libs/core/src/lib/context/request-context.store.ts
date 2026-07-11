import type { ClsStore } from 'nestjs-cls';

// Seeded once per request (see apps/api LoggingModule + BetterAuthGuard) and read back
// anywhere in the async call chain — pino mixin, Sentry tagging, CQRS instrumentation —
// without threading these values through every function signature.
export interface RequestContextStore extends ClsStore {
  requestId?: string;
  correlationId?: string;
  userId?: string;
}

export const REQUEST_CONTEXT_KEYS = {
  requestId: 'requestId',
  correlationId: 'correlationId',
  userId: 'userId',
} as const;
