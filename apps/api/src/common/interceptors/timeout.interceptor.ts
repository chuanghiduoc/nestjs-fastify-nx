import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
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
// For an idempotent request (carrying an Idempotency-Key), the source stays subscribed after the 504
// so a late 2xx completion is recorded into the idempotency store — a retry then replays it instead
// of re-executing the mutation (the double-execution the Idempotency-Key exists to prevent).
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
    if (this.timeoutMs <= 0 || context.getType() === 'ws') {
      return next.handle();
    }

    // getRequest() is meaningful only for HTTP; for GraphQL it yields a non-request value (no
    // idempotency), so this falls through to the fast path.
    const request = context.switchToHttp().getRequest<RequestWithIdempotency>() as
      RequestWithIdempotency | undefined;

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

    return new Observable<unknown>((subscriber) => {
      let timedOut = false;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        subscriber.error(this.timeoutException());
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
          // re-running. Best-effort and never throws (no-ops if the pending lock already expired).
          void idempotency.completeLate(successStatus, value);
        },
        error: (err: unknown) => {
          if (!timedOut) {
            settled = true;
            clearTimeout(timer);
            subscriber.error(this.mapError(err));
          }
          // Late failure: nothing to record; the pending lock lapses at its TTL.
        },
        complete: () => {
          if (!timedOut) subscriber.complete();
        },
      });

      // On the 504 path downstream unsubscribes immediately — keep the source alive to catch the late
      // result; only tear it down on the normal path.
      return () => {
        clearTimeout(timer);
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
}
