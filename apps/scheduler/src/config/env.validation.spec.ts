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
});
