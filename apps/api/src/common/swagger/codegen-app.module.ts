// HTTP-only module for OpenAPI codegen — drops Socket.io/GraphQL/Sentry/Metrics
// to avoid opening Redis sockets and side-effect listeners during spec export.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { RedisCacheModule, RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { BetterAuthModule, BetterAuthGuard, RolesGuard } from '@nestjs-fastify-nx/infra-auth';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import { AdminModule } from '@nestjs-fastify-nx/modules-admin';
import { AuditLogModule } from '@nestjs-fastify-nx/modules-audit-log';
import { LoggingModule } from '../logging/logging.module';
import { HealthModule } from '../health/health.module';
import { ThrottlerModule } from '../throttler/throttler.module';
import { UploadModule } from '../upload/upload.module';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import { validateConfig } from '../../config/env.validation';
import { AppController } from '../../app/app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateConfig }),
    ThrottlerModule,
    LoggingModule,
    HealthModule,
    DatabaseModule,
    RedisCacheModule,
    RedisQueueModule,
    MessagingModule,
    StorageModule,
    BetterAuthModule.forRootAsync({
      useFactory: () => ({}),
    }),
    UsersModule,
    AdminModule,
    AuditLogModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: BetterAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class CodegenAppModule {}
