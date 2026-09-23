import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  databaseEnvShape,
  envFlag,
  mailEnvShape,
  otelEnvShape,
  outboxPurgeEnvShape,
  outboxRelayEnvShape,
  parseEnvOrThrow,
  refineDatabasePoolBounds,
  refineDatabaseUrlProd,
  refineMailProd,
  refineOutboxRetryBounds,
  refineRedisQueuePasswordProd,
  refineStorageProd,
  sentryEnvShape,
} from './env-schema';

describe('envFlag', () => {
  it('defaults to the given value when unset', () => {
    const schema = z.object({ FLAG: envFlag(true) });
    expect(schema.parse({}).FLAG).toBe(true);
    expect(z.object({ FLAG: envFlag(false) }).parse({}).FLAG).toBe(false);
  });

  it('only treats the literal string "true" as true', () => {
    const schema = z.object({ FLAG: envFlag(false) });
    expect(schema.parse({ FLAG: 'true' }).FLAG).toBe(true);
    expect(schema.parse({ FLAG: 'false' }).FLAG).toBe(false);
    expect(schema.parse({ FLAG: 'yes' }).FLAG).toBe(false);
  });
});

describe('databaseEnvShape', () => {
  it('applies the given application name as the default', () => {
    const schema = z.object(databaseEnvShape('my-app'));
    const result = schema.parse({ DATABASE_URL: 'postgresql://localhost/app' });
    expect(result.DATABASE_APPLICATION_NAME).toBe('my-app');
  });
});

describe('otelEnvShape', () => {
  it('applies the given service name as the default', () => {
    const schema = z.object(otelEnvShape('my-service'));
    expect(schema.parse({}).OTEL_SERVICE_NAME).toBe('my-service');
  });
});

describe('sentryEnvShape', () => {
  it('applies the given sample-rate default', () => {
    const schema = z.object(sentryEnvShape(0.1));
    expect(schema.parse({}).SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
  });
});

describe('mailEnvShape', () => {
  it('parses TLS flags as booleans with the documented defaults', () => {
    const schema = z.object(mailEnvShape());
    const result = schema.parse({});
    expect(result.MAIL_IGNORE_TLS).toBe(true);
    expect(result.MAIL_SECURE).toBe(false);
    expect(result.MAIL_REQUIRE_TLS).toBe(false);
  });
});

describe('outboxRelayEnvShape', () => {
  it('rejects a poll interval below the unified 100ms floor', () => {
    const schema = z.object(outboxRelayEnvShape());
    expect(() => schema.parse({ OUTBOX_POLL_INTERVAL_MS: '50' })).toThrow();
  });

  it('rejects a poll interval above the unified 60s ceiling', () => {
    const schema = z.object(outboxRelayEnvShape());
    expect(() => schema.parse({ OUTBOX_POLL_INTERVAL_MS: '60001' })).toThrow();
  });

  it('rejects a max-attempts value above the unified cap of 100', () => {
    const schema = z.object(outboxRelayEnvShape());
    expect(() => schema.parse({ OUTBOX_MAX_ATTEMPTS: '101' })).toThrow();
  });

  it('accepts the shared default values', () => {
    const schema = z.object(outboxRelayEnvShape());
    const result = schema.parse({});
    expect(result.OUTBOX_POLL_INTERVAL_MS).toBe(1_000);
    expect(result.OUTBOX_MAX_ATTEMPTS).toBe(10);
  });
});

describe('outboxPurgeEnvShape', () => {
  it('applies documented defaults', () => {
    const schema = z.object(outboxPurgeEnvShape());
    const result = schema.parse({});
    expect(result.OUTBOX_RETENTION_DAYS).toBe(7);
    expect(result.OUTBOX_PURGE_BATCH_SIZE).toBe(1000);
    expect(result.OUTBOX_PURGE_MAX_BATCHES).toBe(200);
  });
});

describe('refineDatabasePoolBounds', () => {
  it('flags DATABASE_POOL_MIN greater than DATABASE_POOL_MAX', () => {
    const schema = z
      .object({ DATABASE_POOL_MIN: z.number(), DATABASE_POOL_MAX: z.number() })
      .superRefine(refineDatabasePoolBounds);
    expect(() => schema.parse({ DATABASE_POOL_MIN: 5, DATABASE_POOL_MAX: 1 })).toThrow(
      /DATABASE_POOL_MIN/,
    );
  });
});

describe('refineOutboxRetryBounds', () => {
  it('flags OUTBOX_RETRY_BASE_MS greater than OUTBOX_RETRY_MAX_MS', () => {
    const schema = z
      .object({ OUTBOX_RETRY_BASE_MS: z.number(), OUTBOX_RETRY_MAX_MS: z.number() })
      .superRefine(refineOutboxRetryBounds);
    expect(() =>
      schema.parse({ OUTBOX_RETRY_BASE_MS: 10_000, OUTBOX_RETRY_MAX_MS: 1_000 }),
    ).toThrow(/OUTBOX_RETRY_BASE_MS/);
  });
});

describe('refineDatabaseUrlProd', () => {
  it('rejects a non-postgres scheme', () => {
    const schema = z.object({ DATABASE_URL: z.string() }).superRefine(refineDatabaseUrlProd);
    expect(() => schema.parse({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('accepts postgres and postgresql schemes', () => {
    const schema = z.object({ DATABASE_URL: z.string() }).superRefine(refineDatabaseUrlProd);
    expect(() => schema.parse({ DATABASE_URL: 'postgres://localhost/db' })).not.toThrow();
    expect(() => schema.parse({ DATABASE_URL: 'postgresql://localhost/db' })).not.toThrow();
  });
});

describe('refineStorageProd', () => {
  it('rejects default minio credentials', () => {
    const schema = z
      .object({ STORAGE_ACCESS_KEY: z.string(), STORAGE_SECRET_KEY: z.string() })
      .superRefine(refineStorageProd);
    expect(() =>
      schema.parse({ STORAGE_ACCESS_KEY: 'minioadmin', STORAGE_SECRET_KEY: 'real' }),
    ).toThrow(/STORAGE_ACCESS_KEY/);
  });
});

describe('refineRedisQueuePasswordProd', () => {
  it('requires a queue password', () => {
    const schema = z
      .object({ REDIS_QUEUE_PASSWORD: z.string().optional() })
      .superRefine(refineRedisQueuePasswordProd);
    expect(() => schema.parse({})).toThrow(/REDIS_QUEUE_PASSWORD/);
    expect(() => schema.parse({ REDIS_QUEUE_PASSWORD: 'pw' })).not.toThrow();
  });
});

describe('refineMailProd', () => {
  const base = {
    MAIL_HOST: 'smtp.example.com',
    MAIL_DEFAULT_EMAIL: 'ops@example.com',
    MAIL_USER: '',
    MAIL_IGNORE_TLS: false,
    MAIL_SECURE: false,
    MAIL_REQUIRE_TLS: false,
  };
  const schema = z
    .object({
      MAIL_HOST: z.string(),
      MAIL_DEFAULT_EMAIL: z.string(),
      MAIL_USER: z.string(),
      MAIL_IGNORE_TLS: z.boolean(),
      MAIL_SECURE: z.boolean(),
      MAIL_REQUIRE_TLS: z.boolean(),
    })
    .superRefine(refineMailProd);

  it('skips TLS checks when MAIL_USER is unset', () => {
    expect(() => schema.parse(base)).not.toThrow();
  });

  it('requires TLS when MAIL_USER is set', () => {
    expect(() => schema.parse({ ...base, MAIL_USER: 'user' })).toThrow(/MAIL_REQUIRE_TLS/);
  });

  it('rejects the default noreply sender', () => {
    expect(() => schema.parse({ ...base, MAIL_DEFAULT_EMAIL: 'noreply@example.com' })).toThrow(
      /MAIL_DEFAULT_EMAIL/,
    );
  });
});

describe('parseEnvOrThrow', () => {
  it('throws a labeled, formatted error on failure', () => {
    const schema = z.object({ REQUIRED: z.string() });
    expect(() => parseEnvOrThrow(schema, {}, 'Worker environment')).toThrow(
      /Worker environment validation failed/,
    );
  });

  it('strips empty-string env values before validation', () => {
    const schema = z.object({ OPTIONAL: z.string().optional().default('fallback') });
    expect(parseEnvOrThrow(schema, { OPTIONAL: '' }, 'Test').OPTIONAL).toBe('fallback');
  });
});
