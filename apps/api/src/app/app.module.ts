import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { GqlThrottlerGuard } from '../common/throttler/gql-throttler.guard';
import { SentryModule } from '@sentry/nestjs/setup';
import { CqrsInstrumentationInitializer } from '@nestjs-fastify-nx/core';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { RedisCacheModule, RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { BetterAuthModule, BetterAuthGuard, RolesGuard } from '@nestjs-fastify-nx/infra-auth';
import { I18nInfraModule } from '@nestjs-fastify-nx/infra-i18n';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import { AdminModule } from '@nestjs-fastify-nx/composition-admin';
import { AuditLogModule } from '@nestjs-fastify-nx/modules-audit-log';
import { LoggingModule } from '../common/logging/logging.module';
import { HealthModule } from '../common/health/health.module';
import { MetricsModule } from '../common/metrics/metrics.module';
import { ThrottlerModule } from '../common/throttler/throttler.module';
import { UploadModule } from '@nestjs-fastify-nx/modules-upload';
import { GraphqlModule } from '../graphql/graphql.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter';
import { TimeoutInterceptor } from '../common/interceptors';
import { validateConfig } from '../config/env.validation';
import { AppController } from './app.controller';

const conditionalImports = process.env['ENABLE_METRICS'] === 'true' ? [MetricsModule] : [];

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate: validateConfig }),
    // Global CommandBus/QueryBus; the explorer auto-registers @CommandHandler/@QueryHandler
    // providers across all loaded modules — no manual handler wiring in controllers/resolvers.
    CqrsModule.forRoot(),
    I18nInfraModule.forRoot(),
    ThrottlerModule,
    LoggingModule,
    HealthModule,
    DatabaseModule,
    RedisCacheModule,
    RedisQueueModule,
    MessagingModule,
    StorageModule,
    // `users.registered` events are emitted by a Postgres AFTER INSERT trigger
    // on `users` (see prisma/migrations/*_add_user_registered_outbox_trigger).
    // The trigger writes the outbox row inside the same transaction as the
    // user insert, so signup + event are atomic. The outbox relay then
    // dispatches to in-process listeners — no application-side hook needed.
    BetterAuthModule,
    UsersModule,
    AdminModule,
    AuditLogModule,
    UploadModule,
    GraphqlModule,
    WebsocketModule,
    ...conditionalImports,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    { provide: APP_GUARD, useClass: BetterAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Aborts handlers exceeding HTTP_REQUEST_TIMEOUT_MS with a 504 so a hung await can't pin a
    // worker. Auth routes bypass the Nest pipeline (reply.hijack) and are unaffected.
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    // Attaches tracing/metrics to the CommandBus/QueryBus singleton CqrsModule.forRoot()
    // already created above — see CqrsInstrumentationInitializer for why this can't be a
    // `{ provide: CommandBus, useClass }` DI override instead.
    CqrsInstrumentationInitializer,
  ],
})
export class AppModule {}
