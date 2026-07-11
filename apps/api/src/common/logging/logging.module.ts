import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule } from 'nestjs-cls';
import type { IncomingMessage } from 'http';
import { buildPinoLoggerConfig } from '@nestjs-fastify-nx/infra-observability';
import { REQUEST_CONTEXT_KEYS } from '@nestjs-fastify-nx/core';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { resolveRequestId } from './request-id';

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
          const requestId = resolveRequestId(req.headers as Record<string, unknown>);
          const correlationId = (req.headers['x-correlation-id'] as string) || requestId;
          cls.set(REQUEST_CONTEXT_KEYS.requestId, requestId);
          cls.set(REQUEST_CONTEXT_KEYS.correlationId, correlationId);
        },
      },
    }),
    LoggerModule.forRoot(
      buildPinoLoggerConfig({
        customProps: (req: IncomingMessage & { correlationId?: string; requestId?: string }) =>
          ({
            correlationId: req.correlationId,
            requestId: req.requestId,
          }) as Record<string, unknown>,
      }),
    ),
  ],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
