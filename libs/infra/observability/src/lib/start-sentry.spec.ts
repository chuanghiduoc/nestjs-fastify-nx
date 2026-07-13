import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nestjs';
import { startSentry } from './start-sentry';

vi.mock('@sentry/nestjs', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
}));
vi.mock('@sentry/profiling-node', () => ({ nodeProfilingIntegration: vi.fn(() => 'profiling') }));

describe('startSentry', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('is disabled without a DSN', () => {
    delete process.env['SENTRY_DSN'];
    expect(startSentry({ serviceName: 'worker' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('caps rates and recursively scrubs sensitive fields', () => {
    process.env['SENTRY_DSN'] = 'https://public@example.invalid/1';
    process.env['NODE_ENV'] = 'production';
    process.env['SENTRY_TRACES_SAMPLE_RATE'] = '0.8';
    expect(startSentry({ serviceName: 'worker' })).toBe(true);

    const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options?.tracesSampleRate).toBe(0.1);
    const event = {
      type: undefined,
      extra: { nested: { password: 'secret', safe: 'value' } },
      request: { headers: { authorization: 'Bearer secret' } },
    };
    expect(options?.beforeSend?.(event, {})).toEqual({
      type: undefined,
      extra: { nested: { password: '[Filtered]', safe: 'value' } },
      request: { headers: { authorization: '[Filtered]' } },
    });
  });
});
