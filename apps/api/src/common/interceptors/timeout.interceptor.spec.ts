import { describe, it, expect, vi } from 'vitest';
import { HttpException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import type { EnvConfig } from '../../config/env.validation';
import { TimeoutInterceptor } from './timeout.interceptor';

function makeContext(type: 'http' | 'ws', request?: unknown): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => (): undefined => undefined,
    switchToHttp: () => ({ getRequest: () => request ?? { method: 'GET' } }),
  } as unknown as ExecutionContext;
}

function makeInterceptor(
  timeoutMs: number,
  headers?: { name: string; value: string }[],
): TimeoutInterceptor {
  const config = { get: () => timeoutMs } as unknown as ConfigService<EnvConfig, true>;
  const reflector = {
    get: (key: unknown) => (key === HEADERS_METADATA ? headers : undefined),
  } as unknown as Reflector;
  return new TimeoutInterceptor(config, reflector);
}

function handlerEmitting(value: unknown, afterMs = 0): CallHandler {
  return {
    handle: () => (afterMs > 0 ? of(value).pipe(delay(afterMs)) : of(value)),
  } as unknown as CallHandler;
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  describe('idempotent request late-completion', () => {
    it('records the late 2xx completion after the 504 so a retry can replay it', async () => {
      const completeLate = vi.fn().mockResolvedValue(undefined);
      const request = { method: 'POST', idempotency: { completeLate } };
      const subject = new Subject<unknown>();
      const handler = { handle: () => subject.asObservable() } as unknown as CallHandler;
      // 50ms budget → the source stays subscribed for a ~50ms window after the 504 (late-capture
      // safety-net), so emitting right after the 504 lands well inside it.
      const interceptor = makeInterceptor(50);

      const settled = firstValueFrom(
        interceptor.intercept(makeContext('http', request), handler),
      ).catch((e: unknown) => e);
      const err = await settled; // resolves when the 504 fires (~50ms)
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(504);
      expect(completeLate).not.toHaveBeenCalled();

      // Handler finishes AFTER the 504 — must be recorded with the POST default status (201) and no
      // explicit content type (defaults to application/json inside completeLate).
      subject.next('late-result');
      subject.complete();
      await tick(0);
      expect(completeLate).toHaveBeenCalledWith(201, 'late-result', undefined);
    });

    it("replays with the handler's @Header content-type for a late completion", async () => {
      const completeLate = vi.fn().mockResolvedValue(undefined);
      const request = { method: 'POST', idempotency: { completeLate } };
      const subject = new Subject<unknown>();
      const handler = { handle: () => subject.asObservable() } as unknown as CallHandler;
      const interceptor = makeInterceptor(50, [{ name: 'Content-Type', value: 'text/csv' }]);

      const settled = firstValueFrom(
        interceptor.intercept(makeContext('http', request), handler),
      ).catch((e: unknown) => e);
      await settled;

      subject.next('a,b,c');
      subject.complete();
      await tick(0);
      expect(completeLate).toHaveBeenCalledWith(201, 'a,b,c', 'text/csv');
    });

    it('does not call completeLate when the idempotent handler finishes in time', async () => {
      const completeLate = vi.fn();
      const request = { method: 'POST', idempotency: { completeLate } };
      const interceptor = makeInterceptor(1000);

      const result = await firstValueFrom(
        interceptor.intercept(makeContext('http', request), handlerEmitting('ok')),
      );

      expect(result).toBe('ok');
      expect(completeLate).not.toHaveBeenCalled();
    });
  });
});
