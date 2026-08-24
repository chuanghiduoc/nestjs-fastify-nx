import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { AUTHORIZATION_PORT } from '@nestjs-fastify-nx/core';
import { PostgresPbacAdapter } from './postgres-pbac.adapter';
import { PermissionGuard } from './permission.guard';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: AUTHORIZATION_PORT, useClass: PostgresPbacAdapter }, PermissionGuard],
  exports: [AUTHORIZATION_PORT, PermissionGuard],
})
export class AuthorizationModule {}
