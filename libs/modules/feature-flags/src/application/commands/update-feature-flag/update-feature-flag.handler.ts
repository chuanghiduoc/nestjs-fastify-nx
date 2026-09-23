import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
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
  constructor(@Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort) {}

  async execute(command: UpdateFeatureFlagCommand): Promise<FeatureFlagDto> {
    const existing = await this.flags.findById(command.organizationId, command.id);
    if (!existing) throw featureFlagNotFound();

    const changes: FeatureFlagChanges = {
      description: command.description,
      enabled: command.enabled,
      rolloutPercentage: command.rolloutPercentage,
    };
    const updated = existing.withChanges(changes);

    const applied = await this.flags.update(
      command.organizationId,
      command.id,
      changes,
      updated.updatedAt,
    );
    if (!applied) throw featureFlagNotFound();

    return toFeatureFlagDto(updated);
  }
}
