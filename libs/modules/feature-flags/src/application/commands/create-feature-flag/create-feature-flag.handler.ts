import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EVENT_PUBLISHER_PORT, type EventPublisherPort } from '@nestjs-fastify-nx/core';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import { FeatureFlag } from '../../../domain/entities/feature-flag.entity';
import { toFeatureFlagDto, type FeatureFlagDto } from '../../dto/feature-flag.dto';
import { CreateFeatureFlagCommand } from './create-feature-flag.command';

@CommandHandler(CreateFeatureFlagCommand)
export class CreateFeatureFlagHandler implements ICommandHandler<
  CreateFeatureFlagCommand,
  FeatureFlagDto
> {
  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort,
    private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER_PORT) private readonly events: EventPublisherPort,
  ) {}

  async execute(command: CreateFeatureFlagCommand): Promise<FeatureFlagDto> {
    const flag = FeatureFlag.create({
      organizationId: command.organizationId,
      key: command.key,
      description: command.description,
      enabled: command.enabled,
      rolloutPercentage: command.rolloutPercentage,
    });

    await this.prisma.transaction(async () => {
      await this.flags.create(flag);
      await this.events.publish({
        eventId: generateId(),
        eventType: DOMAIN_EVENTS.FEATURE_FLAGS_CREATED,
        aggregateId: flag.id,
        occurredAt: new Date(),
        organizationId: command.organizationId,
        payload: {
          userId: command.userId,
          key: flag.key,
          enabled: flag.enabled,
          rolloutPercentage: flag.rolloutPercentage,
          description: flag.description,
        },
      });
    });

    return toFeatureFlagDto(flag);
  }
}
