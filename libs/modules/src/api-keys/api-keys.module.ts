import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { API_KEY_REPOSITORY } from './api-key-repository.port';
import { PrismaApiKeyRepository } from './prisma-api-key.repository';
import { ListApiKeysHandler } from './list-api-keys';
import { CreateApiKeyHandler } from './create-api-key';
import { RevokeApiKeyHandler } from './revoke-api-key';
import { ApiKeysController } from './api-keys.controller';

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [ApiKeysController],
  providers: [
    { provide: API_KEY_REPOSITORY, useClass: PrismaApiKeyRepository },
    ListApiKeysHandler,
    CreateApiKeyHandler,
    RevokeApiKeyHandler,
  ],
})
export class ApiKeysModule {}
