import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HEADERS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import type { FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import type { EnvConfig } from '../../config/env.validation';
import type { IdempotencyContext } from '../idempotency/register-idempotency';

type RequestWithIdempotency = FastifyRequest & { idempotency?: IdempotencyContext };

// Caps handler execution time so a hung awaited call (slow upstream, lock contention) can't pin a
// Fastify worker indefinitely and drain the connection pool. Node cannot cancel the underlying
// promise, so orphaned work still runs to completion in the background — but the client gets a
// prompt 504 and the socket is freed. WebSocket frames are exempt (connections are long-lived by
// design); the GlobalExceptionFilter renders the HttpException below as RFC 9457 problem+json.
//
// For an idempotent HTTP request (carrying an Idempotency-Key), the source stays subscribed for a
// bounded window after the 504 so a late 2xx completion is recorded into the idempotency store — a
// retry then replays it instead of re-executing the mutation (the double-execution the Idempotency-Key
// exists to prevent).
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService<EnvConfig, true>,
    private readonly reflector: Reflector,
  ) {
    this.timeoutMs = config.get('HTTP_REQUEST_TIMEOUT_MS', { infer: true });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = context.getType();
    if (this.timeoutMs <= 0 || type === 'ws') {
      return next.handle();
    }

    // Idempotency capture is HTTP-only: GraphQL (and anything non-http) never carries an idempotency
    // context, and switchToHttp() would yield a non-request value there — so only touch it for http.
    const request =
      type === 'http'
        ? (context.switchToHttp().getRequest<RequestWithIdempotency>() as
            RequestWithIdempotency | undefined)
        : undefined;

    // Fast path (unchanged): non-idempotent requests get a 504 on timeout and the orphaned work is
    // discarded (rxjs timeout() unsubscribes the source).
    if (!request?.idempotency) {
      return next.handle().pipe(
        timeout(this.timeoutMs),
        catchError((err: unknown) => throwError(() => this.mapError(err))),
      );
    }

    const idempotency = request.idempotency;
    const successStatus = this.resolveSuccessStatus(context, request.method);
    const contentType = this.resolveContentType(context);

    return new Observable<unknown>((subscriber) => {
      let timedOut = false;
      let settled = false;
      let lateTimer: NodeJS.Timeout | undefined;

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        subscriber.error(this.timeoutException());
        // Bounded window to capture a late completion, then release the subscription. Beyond it the
        // pending idempotency lock has lapsed (lock TTL > request timeout) so completeLate would
        // no-op anyway — holding the source (and this request) longer would only leak memory.
        lateTimer = setTimeout(() => sub.unsubscribe(), this.timeoutMs);
        lateTimer.unref();
      }, this.timeoutMs);

      const sub = next.handle().subscribe({
        next: (value) => {
          if (!timedOut) {
            settled = true;
            clearTimeout(timer);
            subscriber.next(value);
            return;
          }
          // Late success after the 504 already replied — record it so a retry replays instead of
          // re-running. completeLate swallows its own errors; guard again so nothing escapes here.
          if (lateTimer) clearTimeout(lateTimer);
          void idempotency.completeLate(successStatus, value, contentType).catch(() => undefined);
          sub.unsubscribe();
        },
        error: (err: unknown) => {
          if (!timedOut) {
            settled = true;
            clearTimeout(timer);
            subscriber.error(this.mapError(err));
            return;
          }
          // Late failure: nothing to record; the pending lock lapses at its TTL.
          if (lateTimer) clearTimeout(lateTimer);
          sub.unsubscribe();
        },
        complete: () => {
          if (!timedOut) subscriber.complete();
        },
      });

      // On the 504 path downstream unsubscribes immediately — keep the source alive (bounded by
      // lateTimer) to catch the late result; on the normal path, tear it down at once.
      return () => {
        clearTimeout(timer);
        if (lateTimer) clearTimeout(lateTimer);
        if (!timedOut) sub.unsubscribe();
      };
    });
  }

  private mapError(err: unknown): unknown {
    return err instanceof TimeoutError ? this.timeoutException() : err;
  }

  private timeoutException(): HttpException {
    return new HttpException(
      { code: ERROR_CODES.REQUEST_TIMEOUT, messageKey: I18N_KEYS.common.request_timeout },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }

  // The status a late completion should replay with: the handler's @HttpCode, else Nest's default
  // (201 for POST, 200 otherwise). The reply was already overwritten to 504, so infer it here.
  private resolveSuccessStatus(context: ExecutionContext, method: string): number {
    const explicit = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );
    if (typeof explicit === 'number') return explicit;
    return method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
  }

  // The content type a late completion should replay with: the handler's @Header('Content-Type'),
  // else undefined so completeLate defaults to application/json. Preserves byte-for-byte replay for
  // non-JSON responses (a handler that set it imperatively via reply.header is not captured here).
  private resolveContentType(context: ExecutionContext): string | undefined {
    const headers = this.reflector.get<{ name: string; value: string }[] | undefined>(
      HEADERS_METADATA,
      context.getHandler(),
    );
    return headers?.find((header) => header.name.toLowerCase() === 'content-type')?.value;
  }
}
