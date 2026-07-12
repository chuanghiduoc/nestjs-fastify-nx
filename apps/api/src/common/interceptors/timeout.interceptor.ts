import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import type { EnvConfig } from '../../config/env.validation';

// Caps handler execution time so a hung awaited call (slow upstream, lock contention) can't pin a
// Fastify worker indefinitely and drain the connection pool. Node cannot cancel the underlying
// promise, so orphaned work still runs to completion in the background — but the client gets a
// prompt 504 and the socket is freed. WebSocket frames are exempt (connections are long-lived by
// design); the GlobalExceptionFilter renders the HttpException below as RFC 9457 problem+json.
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly timeoutMs: number;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.timeoutMs = config.get('HTTP_REQUEST_TIMEOUT_MS', { infer: true });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.timeoutMs <= 0 || context.getType() === 'ws') {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((err: unknown) =>
        throwError(() =>
          err instanceof TimeoutError
            ? new HttpException(
                {
                  code: ERROR_CODES.REQUEST_TIMEOUT,
                  messageKey: I18N_KEYS.common.request_timeout,
                },
                HttpStatus.GATEWAY_TIMEOUT,
              )
            : err,
        ),
      ),
    );
  }
}
