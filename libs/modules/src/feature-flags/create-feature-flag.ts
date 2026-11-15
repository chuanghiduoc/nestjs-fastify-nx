import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EVENT_PUBLISHER_PORT, type EventPublisherPort } from '@nestjs-fastify-nx/core';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import {
  FEATURE_FLAG_REPOSITORY,
  type FeatureFlagRepositoryPort,
} from './feature-flag-repository.port';
import { FeatureFlag } from './feature-flag.entity';
import { toFeatureFlagDto, type FeatureFlagDto } from './feature-flag.dto';

export interface CreateFeatureFlagInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly key: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;
}

export class CreateFeatureFlagCommand extends Command<FeatureFlagDto> {
  readonly organizationId: string;
  readonly userId: string;
  readonly key: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;

  constructor(input: CreateFeatureFlagInput) {
    super();
    this.organizationId = input.organizationId;
    this.userId = input.userId;
    this.key = input.key;
    this.description = input.description;
    this.enabled = input.enabled;
    this.rolloutPercentage = input.rolloutPercentage;
  }
}

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
