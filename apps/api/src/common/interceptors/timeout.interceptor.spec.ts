import { describe, it, expect } from 'vitest';
import { HttpException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { firstValueFrom, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import type { EnvConfig } from '../../config/env.validation';
import { TimeoutInterceptor } from './timeout.interceptor';

function makeContext(type: 'http' | 'ws'): ExecutionContext {
  return { getType: () => type } as unknown as ExecutionContext;
}

function makeInterceptor(timeoutMs: number): TimeoutInterceptor {
  const config = { get: () => timeoutMs } as unknown as ConfigService<EnvConfig, true>;
  return new TimeoutInterceptor(config);
}

function handlerEmitting(value: unknown, afterMs = 0): CallHandler {
  return {
    handle: () => (afterMs > 0 ? of(value).pipe(delay(afterMs)) : of(value)),
  } as unknown as CallHandler;
}

describe('TimeoutInterceptor', () => {
  it('passes a fast handler through untouched', async () => {
    const interceptor = makeInterceptor(1000);
    const result = await firstValueFrom(
      interceptor.intercept(makeContext('http'), handlerEmitting('ok')),
    );
    expect(result).toBe('ok');
  });

  it('throws a 504 request_timeout when the handler exceeds the budget', async () => {
    const interceptor = makeInterceptor(10);
    try {
      await firstValueFrom(interceptor.intercept(makeContext('http'), handlerEmitting('late', 50)));
      expect.unreachable('handler should have timed out');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const exception = err as HttpException;
      expect(exception.getStatus()).toBe(504);
      expect((exception.getResponse() as { code: string }).code).toBe('request_timeout');
    }
  });

  it('does not apply to WebSocket contexts', async () => {
    const interceptor = makeInterceptor(10);
    const result = await firstValueFrom(
      interceptor.intercept(makeContext('ws'), handlerEmitting('late', 50)),
    );
    expect(result).toBe('late');
  });

  it('is disabled when the timeout is 0', async () => {
    const interceptor = makeInterceptor(0);
    const result = await firstValueFrom(
      interceptor.intercept(makeContext('http'), handlerEmitting('late', 50)),
    );
    expect(result).toBe('late');
  });

  it('lets non-timeout errors propagate unchanged', async () => {
    const interceptor = makeInterceptor(1000);
    const boom = new Error('boom');
    const handler = { handle: () => throwError(() => boom) } as unknown as CallHandler;
    await expect(firstValueFrom(interceptor.intercept(makeContext('http'), handler))).rejects.toBe(
      boom,
    );
  });
});
