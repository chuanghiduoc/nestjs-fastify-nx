import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EVENT_PUBLISHER_PORT, type EventPublisherPort } from '@nestjs-fastify-nx/core';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagChanges } from '../../../domain/entities/feature-flag.entity';
import { toFeatureFlagDto, type FeatureFlagDto } from '../../dto/feature-flag.dto';
import { featureFlagNotFound } from '../../feature-flag-errors';
import { UpdateFeatureFlagCommand } from './update-feature-flag.command';

@CommandHandler(UpdateFeatureFlagCommand)
export class UpdateFeatureFlagHandler implements ICommandHandler<
  UpdateFeatureFlagCommand,
  FeatureFlagDto
> {
  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort,
    private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER_PORT) private readonly events: EventPublisherPort,
  ) {}

  async execute(command: UpdateFeatureFlagCommand): Promise<FeatureFlagDto> {
    const existing = await this.flags.findById(command.organizationId, command.id);
    if (!existing) throw featureFlagNotFound();

    const changes: FeatureFlagChanges = {
      description: command.description,
      enabled: command.enabled,
      rolloutPercentage: command.rolloutPercentage,
    };
    const updated = existing.withChanges(changes);

    await this.prisma.transaction(async () => {
      const applied = await this.flags.update(
        command.organizationId,
        command.id,
        changes,
        updated.updatedAt,
      );
      if (!applied) throw featureFlagNotFound();

      await this.events.publish({
        eventId: generateId(),
        eventType: DOMAIN_EVENTS.FEATURE_FLAGS_UPDATED,
        aggregateId: updated.id,
        occurredAt: new Date(),
        organizationId: command.organizationId,
        payload: {
          userId: command.userId,
          key: updated.key,
          enabled: updated.enabled,
          previousEnabled: existing.enabled,
          rolloutPercentage: updated.rolloutPercentage,
          previousRolloutPercentage: existing.rolloutPercentage,
          description: updated.description,
        },
      });
    });

    return toFeatureFlagDto(updated);
  }
}
