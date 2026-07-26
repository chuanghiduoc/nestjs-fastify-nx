import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule } from 'nestjs-cls';
import type { IncomingMessage } from 'http';
import { buildPinoLoggerConfig } from '@nestjs-fastify-nx/infra-observability';
import { REQUEST_CONTEXT_KEYS } from '@nestjs-fastify-nx/core';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { ensureRequestIds } from './request-id';

@Module({
  imports: [
    // Imported here (rather than directly by AppModule) so Nx's dependency scan registers
    // ClsRootModule before LoggingModule finishes registering — Nest calls configure() in
    // registration order, so ClsMiddleware (mount: true) always runs before
    // CorrelationIdMiddleware below and requestId/correlationId are already on the CLS store
    // by the time it reads them.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req: IncomingMessage) => {
          // ensureRequestIds (not resolveRequestId) so a Fastify hook that already answered before
          // this middleware — under-pressure's load-shedding handler registers its onRequest hook
          // ahead of middie — shares the id it put on the wire instead of the log carrying a second,
          // unrelated one.
          const { requestId, correlationId } = ensureRequestIds(req, req.headers);
          cls.set(REQUEST_CONTEXT_KEYS.requestId, requestId);
          cls.set(REQUEST_CONTEXT_KEYS.correlationId, correlationId);
        },
      },
    }),
    // No `customProps` for requestId/correlationId — the pino `mixin` in
    // buildPinoLoggerConfig already injects them (from the CLS store) on every log
    // line app-wide. Adding them here too duplicated the keys on each request log.
    LoggerModule.forRoot(buildPinoLoggerConfig()),
  ],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Nest 11's Fastify middleware matcher requires a named optional wildcard.
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*splat}');
  }
}
