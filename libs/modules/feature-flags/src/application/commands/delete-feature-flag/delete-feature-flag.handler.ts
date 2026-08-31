import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import { featureFlagNotFound } from '../../feature-flag-errors';
import { DeleteFeatureFlagCommand } from './delete-feature-flag.command';

@CommandHandler(DeleteFeatureFlagCommand)
export class DeleteFeatureFlagHandler implements ICommandHandler<DeleteFeatureFlagCommand, void> {
  constructor(@Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort) {}

  async execute(command: DeleteFeatureFlagCommand): Promise<void> {
    const deleted = await this.flags.delete(command.organizationId, command.id);
    if (!deleted) throw featureFlagNotFound();
  }
}
