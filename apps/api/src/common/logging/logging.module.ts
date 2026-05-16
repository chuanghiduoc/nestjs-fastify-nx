import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'http';
import { buildPinoLoggerConfig } from '@nestjs-fastify-nx/infra-observability';
import { CorrelationIdMiddleware } from './correlation-id.middleware';

@Module({
  imports: [
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
