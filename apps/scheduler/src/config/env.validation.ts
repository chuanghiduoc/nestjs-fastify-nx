import { z } from 'zod';
import {
  databaseEnvShape,
  nodeEnvShape,
  otelEnvShape,
  outboxPurgeEnvShape,
  outboxRelayEnvShape,
  parseEnvOrThrow,
  redisQueueEnvShape,
  refineDatabasePoolBounds,
  refineDatabaseUrlProd,
  refineOutboxRetryBounds,
  refineRedisQueuePasswordProd,
  refineStorageProd,
  sentryEnvShape,
  storageEnvShape,
} from '@nestjs-fastify-nx/shared';

const schedulerEnvSchema = z
  .object({
    ...databaseEnvShape('nestjs-fastify-scheduler'),

    ...redisQueueEnvShape(),

    ...storageEnvShape(),

    ...nodeEnvShape(),

    ...otelEnvShape('nestjs-fastify-scheduler'),

    AUDIT_LOG_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
    DLQ_ALERT_THRESHOLD: z.coerce.number().int().min(1).max(100_000).default(10),
    INACTIVE_USER_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
    USER_PURGE_BATCH_SIZE: z.coerce.number().int().min(10).max(10_000).default(500),
    USER_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),
    STORED_FILE_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(10).max(10_000).default(500),
    STORED_FILE_FINALIZING_STALE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    STORED_FILE_VERIFYING_STALE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    STORED_FILE_REJECTED_RETAIN_HOURS: z.coerce.number().int().min(1).max(8_760).default(72),
    STORED_FILE_ORPHAN_GRACE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    STORED_FILE_PURGE_AFTER_DAYS: z.coerce.number().int().min(1).max(3_650).default(30),
    STORED_FILE_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),

    ...outboxRelayEnvShape(),
    OUTBOX_TX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),

    ...outboxPurgeEnvShape(),
    OUTBOX_PARKED_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    VERIFICATION_PURGE_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(1),
    VERIFICATION_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10_000).default(1_000),
    VERIFICATION_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),

    SESSION_PURGE_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(1),
    SESSION_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10_000).default(1_000),
    SESSION_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),

    EVENT_PUBLISHER_DRIVER: z.enum(['inprocess', 'outbox']).default('inprocess'),

    ...sentryEnvShape(0.01),
  })
  .superRefine((data, ctx) => {
    refineDatabasePoolBounds(data, ctx);
    refineOutboxRetryBounds(data, ctx);

    if (data.OUTBOX_PARKED_RETENTION_DAYS < data.OUTBOX_RETENTION_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_PARKED_RETENTION_DAYS'],
        message:
          'OUTBOX_PARKED_RETENTION_DAYS must be greater than or equal to OUTBOX_RETENTION_DAYS',
      });
    }

    if (data.NODE_ENV !== 'production') return;

    refineStorageProd(data, ctx);
    refineRedisQueuePasswordProd(data, ctx);
    refineDatabaseUrlProd(data, ctx);

    // The scheduler drains the outbox; in production it must run in outbox mode so relayed events are
    // durable. In-process publishing would silently drop events on crash/rollback.
    if (data.EVENT_PUBLISHER_DRIVER !== 'outbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['EVENT_PUBLISHER_DRIVER'],
        message:
          'EVENT_PUBLISHER_DRIVER must be "outbox" in production for durable, crash-safe event delivery',
      });
    }
  });

export type SchedulerEnvConfig = z.infer<typeof schedulerEnvSchema>;

export function validateSchedulerConfig(config: Record<string, unknown>): SchedulerEnvConfig {
  return parseEnvOrThrow(schedulerEnvSchema, config, 'Scheduler environment');
}
