import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagDto } from '../../dto/feature-flag.dto';
import { featureFlagNotFound } from '../../feature-flag-errors';
import { UpdateFeatureFlagCommand } from './update-feature-flag.command';

@CommandHandler(UpdateFeatureFlagCommand)
export class UpdateFeatureFlagHandler implements ICommandHandler<
  UpdateFeatureFlagCommand,
  FeatureFlagDto
> {
  constructor(@Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort) {}

  async execute(command: UpdateFeatureFlagCommand): Promise<FeatureFlagDto> {
    const existing = await this.flags.findById(command.organizationId, command.id);
    if (!existing) throw featureFlagNotFound();

    const updated = existing.withChanges({
      description: command.description,
      enabled: command.enabled,
      rolloutPercentage: command.rolloutPercentage,
    });
    await this.flags.update(updated);

    return {
      id: updated.id,
      key: updated.key,
      description: updated.description,
      enabled: updated.enabled,
      rolloutPercentage: updated.rolloutPercentage,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
