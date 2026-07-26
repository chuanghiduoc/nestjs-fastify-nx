export { RedisQueueModule, REDIS_QUEUE_CLIENT } from './lib/redis-queue.module';
export { DeadLetterModule, dlqNameFor } from './lib/dead-letter.module';
export { createDeadLetterRouterClass, routeFailedJobToDlq } from './lib/dead-letter-router';
export type { DeadLetterEnvelope } from './lib/dead-letter-router';
export {
  RedisLeaderLease,
  LEASE_TTL_MS,
  LEASE_RENEW_INTERVAL_MS,
  type RedisLeaderLeaseOptions,
} from './lib/redis-leader-lease';
