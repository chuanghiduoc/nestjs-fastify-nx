import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EVENT_PUBLISHER_PORT, type EventPublisherPort } from '@nestjs-fastify-nx/core';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import { featureFlagNotFound } from '../../feature-flag-errors';
import { DeleteFeatureFlagCommand } from './delete-feature-flag.command';

@CommandHandler(DeleteFeatureFlagCommand)
export class DeleteFeatureFlagHandler implements ICommandHandler<DeleteFeatureFlagCommand, void> {
  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort,
    private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER_PORT) private readonly events: EventPublisherPort,
  ) {}

  async execute(command: DeleteFeatureFlagCommand): Promise<void> {
    await this.prisma.transaction(async () => {
      const deleted = await this.flags.delete(command.organizationId, command.id);
      if (!deleted) throw featureFlagNotFound();

      await this.events.publish({
        eventId: generateId(),
        eventType: DOMAIN_EVENTS.FEATURE_FLAGS_DELETED,
        aggregateId: command.id,
        occurredAt: new Date(),
        organizationId: command.organizationId,
        payload: { userId: command.userId },
      });
    });
  }
}
