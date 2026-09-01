import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import { FeatureFlag } from '../../../domain/entities/feature-flag.entity';
import type { FeatureFlagDto } from '../../dto/feature-flag.dto';
import { CreateFeatureFlagCommand } from './create-feature-flag.command';

@CommandHandler(CreateFeatureFlagCommand)
export class CreateFeatureFlagHandler implements ICommandHandler<
  CreateFeatureFlagCommand,
  FeatureFlagDto
> {
  constructor(@Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort) {}

  async execute(command: CreateFeatureFlagCommand): Promise<FeatureFlagDto> {
    const flag = FeatureFlag.create({
      organizationId: command.organizationId,
      key: command.key,
      description: command.description,
      enabled: command.enabled,
      rolloutPercentage: command.rolloutPercentage,
    });

    await this.flags.create(flag);

    return {
      id: flag.id,
      key: flag.key,
      description: flag.description,
      enabled: flag.enabled,
      rolloutPercentage: flag.rolloutPercentage,
      createdAt: flag.createdAt,
      updatedAt: flag.updatedAt,
    };
  }
}
