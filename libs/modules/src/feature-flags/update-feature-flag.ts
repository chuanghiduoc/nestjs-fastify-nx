import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EVENT_PUBLISHER_PORT, type EventPublisherPort } from '@nestjs-fastify-nx/core';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import {
  FEATURE_FLAG_REPOSITORY,
  type FeatureFlagRepositoryPort,
} from './feature-flag-repository.port';
import type { FeatureFlagChanges } from './feature-flag.entity';
import { toFeatureFlagDto, type FeatureFlagDto } from './feature-flag.dto';
import { featureFlagNotFound } from './feature-flag-errors';

export interface UpdateFeatureFlagInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;
}

export class UpdateFeatureFlagCommand extends Command<FeatureFlagDto> {
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;

  constructor(input: UpdateFeatureFlagInput) {
    super();
    this.organizationId = input.organizationId;
    this.userId = input.userId;
    this.id = input.id;
    this.description = input.description;
    this.enabled = input.enabled;
    this.rolloutPercentage = input.rolloutPercentage;
  }
}

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
