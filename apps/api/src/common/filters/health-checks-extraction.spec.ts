import { describe, it, expect } from 'vitest';
import { extractFailingHealthChecks } from './global-exception.filter';

describe('extractFailingHealthChecks', () => {
  it('returns the failing indicators from a terminus HealthCheckResult', () => {
    const result = {
      status: 'error',
      info: { database: { status: 'up' }, redis_queue: { status: 'up' } },
      error: { redis_cache: { status: 'down', message: 'redis_cache check failed' } },
      details: {
        database: { status: 'up' },
        redis_queue: { status: 'up' },
        redis_cache: { status: 'down', message: 'redis_cache check failed' },
      },
    };

    expect(extractFailingHealthChecks(result)).toEqual({
      redis_cache: { status: 'down', message: 'redis_cache check failed' },
    });
  });

  it('returns undefined for a healthy result', () => {
    expect(
      extractFailingHealthChecks({ status: 'ok', info: {}, error: {}, details: {} }),
    ).toBeUndefined();
  });

  it('returns undefined when the error map is empty despite an error status', () => {
    expect(extractFailingHealthChecks({ status: 'error', error: {} })).toBeUndefined();
  });

  it('returns undefined for a non-health exception body', () => {
    expect(extractFailingHealthChecks({ message: 'nope', code: 'bad_request' })).toBeUndefined();
    expect(extractFailingHealthChecks('a string')).toBeUndefined();
    expect(extractFailingHealthChecks(null)).toBeUndefined();
  });
});
