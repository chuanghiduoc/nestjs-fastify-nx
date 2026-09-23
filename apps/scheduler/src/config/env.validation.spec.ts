import { describe, expect, it } from 'vitest';
import { validateSchedulerConfig } from './env.validation';

describe('validateSchedulerConfig', () => {
  it('provides a validated outbox transaction timeout', () => {
    const config = validateSchedulerConfig({ DATABASE_URL: 'postgresql://localhost/app' });

    expect(config.OUTBOX_TX_TIMEOUT_MS).toBe(30_000);
  });

  it('rejects a pool minimum larger than the maximum', () => {
    expect(() =>
      validateSchedulerConfig({
        DATABASE_URL: 'postgresql://localhost/app',
        DATABASE_POOL_MIN: '20',
        DATABASE_POOL_MAX: '10',
      }),
    ).toThrow('DATABASE_POOL_MIN must be less than or equal to DATABASE_POOL_MAX');
  });

  it('rejects an outbox transaction timeout below the supported floor', () => {
    expect(() =>
      validateSchedulerConfig({
        DATABASE_URL: 'postgresql://localhost/app',
        OUTBOX_TX_TIMEOUT_MS: '100',
      }),
    ).toThrow('OUTBOX_TX_TIMEOUT_MS');
  });

  it('rejects an OUTBOX_POLL_INTERVAL_MS below the unified 100ms floor (was 50ms in api)', () => {
    expect(() =>
      validateSchedulerConfig({
        DATABASE_URL: 'postgresql://localhost/app',
        OUTBOX_POLL_INTERVAL_MS: '50',
      }),
    ).toThrow(/OUTBOX_POLL_INTERVAL_MS/);
  });

  it('rejects an OUTBOX_MAX_ATTEMPTS above the unified cap of 100 (was 1000 in api)', () => {
    expect(() =>
      validateSchedulerConfig({
        DATABASE_URL: 'postgresql://localhost/app',
        OUTBOX_MAX_ATTEMPTS: '500',
      }),
    ).toThrow(/OUTBOX_MAX_ATTEMPTS/);
  });

  it('rejects a non-postgres DATABASE_URL in production', () => {
    expect(() =>
      validateSchedulerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://localhost/app',
        STORAGE_ACCESS_KEY: 'real-key',
        STORAGE_SECRET_KEY: 'real-secret',
        REDIS_QUEUE_PASSWORD: 'queue-pw',
        EVENT_PUBLISHER_DRIVER: 'outbox',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects OUTBOX_PARKED_RETENTION_DAYS shorter than OUTBOX_RETENTION_DAYS', () => {
    expect(() =>
      validateSchedulerConfig({
        DATABASE_URL: 'postgresql://localhost/app',
        OUTBOX_RETENTION_DAYS: '10',
        OUTBOX_PARKED_RETENTION_DAYS: '5',
      }),
    ).toThrow(/OUTBOX_PARKED_RETENTION_DAYS/);
  });

  it('accepts OUTBOX_PARKED_RETENTION_DAYS equal to OUTBOX_RETENTION_DAYS', () => {
    expect(() =>
      validateSchedulerConfig({
        DATABASE_URL: 'postgresql://localhost/app',
        OUTBOX_RETENTION_DAYS: '10',
        OUTBOX_PARKED_RETENTION_DAYS: '10',
      }),
    ).not.toThrow();
  });
});
