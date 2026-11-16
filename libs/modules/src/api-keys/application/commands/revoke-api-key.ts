import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import {
  DomainException,
  EVENT_PUBLISHER_PORT,
  type EventPublisherPort,
} from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS, fieldProblem } from '@nestjs-fastify-nx/contracts';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import {
  API_KEY_REPOSITORY,
  type ApiKeyRepositoryPort,
} from '../../domain/ports/api-key-repository.port';

export class RevokeApiKeyCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
    readonly id: string,
  ) {
    super();
  }
}

@CommandHandler(RevokeApiKeyCommand)
export class RevokeApiKeyHandler implements ICommandHandler<RevokeApiKeyCommand, void> {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort,
    private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER_PORT) private readonly events: EventPublisherPort,
  ) {}

  async execute(command: RevokeApiKeyCommand): Promise<void> {
    await this.prisma.transaction(async () => {
      const revoked = await this.apiKeys.revoke(command.organizationId, command.id, new Date());
      if (revoked) {
        await this.events.publish({
          eventId: generateId(),
          eventType: DOMAIN_EVENTS.API_KEYS_REVOKED,
          aggregateId: command.id,
          occurredAt: new Date(),
          organizationId: command.organizationId,
          payload: { userId: command.userId },
        });
        return;
      }
      if (await this.apiKeys.exists(command.organizationId, command.id)) return;

      throw new DomainException(
        fieldProblem({
          kind: 'not_found',
          code: ERROR_CODES.API_KEY_NOT_FOUND,
          messageKey: I18N_KEYS.errors.api_keys.not_found,
          path: 'id',
          message: 'API key not found',
        }),
      );
    });
  }
}
