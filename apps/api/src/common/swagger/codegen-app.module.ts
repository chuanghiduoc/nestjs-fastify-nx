// HTTP-only module for OpenAPI spec export — drops Socket.io/GraphQL/Sentry/Metrics to avoid opening sockets.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { BetterAuthModule, BetterAuthGuard, RolesGuard } from '@nestjs-fastify-nx/infra-auth';
import { AuthorizationModule, PermissionGuard } from '@nestjs-fastify-nx/infra-authorization';
import { I18nInfraModule } from '@nestjs-fastify-nx/infra-i18n';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import { AdminModule } from '@nestjs-fastify-nx/composition-admin';
import { AuditLogModule } from '@nestjs-fastify-nx/modules-audit-log';
import { OrganizationsModule } from '@nestjs-fastify-nx/modules-organizations';
import { ApiKeysModule } from '@nestjs-fastify-nx/modules-api-keys';
import { NotificationsModule } from '@nestjs-fastify-nx/modules-notifications';
import { FeatureFlagsModule } from '@nestjs-fastify-nx/modules-feature-flags';
import { TermsModule } from '@nestjs-fastify-nx/modules-terms';
import { SessionsModule } from '@nestjs-fastify-nx/modules-sessions';
import { LoggingModule } from '../logging/logging.module';
import { HealthModule } from '../health/health.module';
import { ThrottlerModule } from '../throttler/throttler.module';
import { UploadModule } from '@nestjs-fastify-nx/modules-upload';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { validateConfig } from '../../config/env.validation';
import { AppController } from '../../app/app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateConfig }),
    CqrsModule.forRoot(),
    I18nInfraModule.forRoot(),
    ThrottlerModule,
    LoggingModule,
    HealthModule,
    DatabaseModule,
    AuthorizationModule,
    RedisQueueModule,
    MessagingModule,
    StorageModule,
    BetterAuthModule,
    UsersModule,
    AdminModule,
    AuditLogModule,
    OrganizationsModule,
    ApiKeysModule,
    NotificationsModule,
    FeatureFlagsModule,
    TermsModule,
    SessionsModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: BetterAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class CodegenAppModule {}
