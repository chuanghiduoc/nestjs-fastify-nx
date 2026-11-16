import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra/database';
import { MessagingModule } from '@nestjs-fastify-nx/infra/messaging';
import { API_KEY_REPOSITORY } from './domain/ports/api-key-repository.port';
import { PrismaApiKeyRepository } from './infrastructure/repositories/prisma-api-key.repository';
import { ListApiKeysHandler } from './application/queries/list-api-keys';
import { CreateApiKeyHandler } from './application/commands/create-api-key';
import { RevokeApiKeyHandler } from './application/commands/revoke-api-key';
import { ApiKeysController } from './presentation/controllers/api-keys.controller';

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [ApiKeysController],
  providers: [
    { provide: API_KEY_REPOSITORY, useClass: PrismaApiKeyRepository },
    ListApiKeysHandler,
    CreateApiKeyHandler,
    RevokeApiKeyHandler,
  ],
  exports: [API_KEY_REPOSITORY],
})
export class ApiKeysModule {}
