import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AUTHORIZATION_PORT, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import { API_KEY_REPOSITORY } from '../../../domain/ports/api-key-repository.port';
import type { ApiKeyRepositoryPort } from '../../../domain/ports/api-key-repository.port';
import { ApiKey } from '../../../domain/entities/api-key.entity';
import type { IssuedApiKeyDto } from '../../dto/api-key.dto';
import { CreateApiKeyCommand } from './create-api-key.command';

@CommandHandler(CreateApiKeyCommand)
export class CreateApiKeyHandler implements ICommandHandler<CreateApiKeyCommand, IssuedApiKeyDto> {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
  ) {}

  async execute(command: CreateApiKeyCommand): Promise<IssuedApiKeyDto> {
    const grantedToIssuer = await this.authorization.permissionsFor({
      type: 'user',
      userId: command.userId,
      organizationId: command.organizationId,
    });

    const { entity, raw } = ApiKey.issue({
      organizationId: command.organizationId,
      name: command.name,
      scopes: command.scopes,
      createdById: command.userId,
      expiresAt: command.expiresAt ?? null,
      grantedToIssuer,
    });

    await this.apiKeys.create(entity);

    return {
      id: entity.id,
      name: entity.name,
      prefix: entity.prefix,
      scopes: entity.scopes,
      createdById: entity.createdById,
      lastUsedAt: entity.lastUsedAt,
      expiresAt: entity.expiresAt,
      revokedAt: entity.revokedAt,
      createdAt: entity.createdAt,
      key: raw,
    };
  }
}
