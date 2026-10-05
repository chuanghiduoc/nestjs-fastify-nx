import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nestjs';
import { reportFatalError, startSentry } from './start-sentry';

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
      extra: {
        nested: {
          password: 'secret',
          safe: 'token=top-secret email=person@example.com',
          url: 'https://example.test/reset?token=top-secret',
        },
      },
      request: { headers: { authorization: 'Bearer secret' } },
    };
    expect(options?.beforeSend?.(event, {})).toEqual({
      type: undefined,
      extra: {
        nested: {
          password: '[Filtered]',
          safe: 'token=[REDACTED] email=[REDACTED_EMAIL]',
          url: 'https://example.test/reset',
        },
      },
      request: { headers: { authorization: '[Filtered]' } },
    });
  });

  it('enables trace-scoped profiling only when requested', () => {
    process.env['SENTRY_DSN'] = 'https://public@example.invalid/1';
    process.env['NODE_ENV'] = 'production';

    startSentry({ serviceName: 'api', profiling: true });
    startSentry({ serviceName: 'worker' });

    const [profiled, unprofiled] = vi.mocked(Sentry.init).mock.calls.map(([options]) => options);
    expect(profiled?.profileSessionSampleRate).toBe(0.1);
    expect(profiled?.profileLifecycle).toBe('trace');
    expect(profiled?.integrations).toEqual(['profiling']);
    expect(unprofiled?.profileSessionSampleRate).toBe(0);
    expect(unprofiled?.integrations).toBeUndefined();
  });

  it('keeps personal and payload data out of every event', () => {
    process.env['SENTRY_DSN'] = 'https://public@example.invalid/1';
    startSentry({ serviceName: 'api' });

    expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]?.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    });
  });

  it('reports fatal errors without writing their message or stack to stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await reportFatalError(new Error('postgresql://admin:secret@db/app'), 'worker');
    expect(stderr).toHaveBeenCalledWith('[worker] fatal bootstrap error: Error\n');
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
