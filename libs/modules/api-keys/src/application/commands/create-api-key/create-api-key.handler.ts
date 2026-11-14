import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import {
  AUTHORIZATION_PORT,
  EVENT_PUBLISHER_PORT,
  type AuthorizationPort,
  type EventPublisherPort,
} from '@nestjs-fastify-nx/core';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import { API_KEY_REPOSITORY } from '../../../domain/ports/api-key-repository.port';
import type { ApiKeyRepositoryPort } from '../../../domain/ports/api-key-repository.port';
import { ApiKey } from '../../../domain/entities/api-key.entity';
import { toApiKeyDto, type IssuedApiKeyDto } from '../../dto/api-key.dto';
import { CreateApiKeyCommand } from './create-api-key.command';

@CommandHandler(CreateApiKeyCommand)
export class CreateApiKeyHandler implements ICommandHandler<CreateApiKeyCommand, IssuedApiKeyDto> {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
    private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER_PORT) private readonly events: EventPublisherPort,
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

    await this.prisma.transaction(async () => {
      await this.apiKeys.create(entity);
      await this.events.publish({
        eventId: generateId(),
        eventType: DOMAIN_EVENTS.API_KEYS_ISSUED,
        aggregateId: entity.id,
        occurredAt: new Date(),
        organizationId: command.organizationId,
        payload: {
          userId: command.userId,
          name: entity.name,
          scopes: [...entity.scopes],
          expiresAt: entity.expiresAt?.toISOString() ?? null,
        },
      });
    });

    return { ...toApiKeyDto(entity), key: raw };
  }
}
