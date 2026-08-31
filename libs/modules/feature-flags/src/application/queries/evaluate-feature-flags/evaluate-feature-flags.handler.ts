import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { FEATURE_FLAG_REPOSITORY } from '../../../domain/ports/feature-flag-repository.port';
import type { FeatureFlagRepositoryPort } from '../../../domain/ports/feature-flag-repository.port';
import type { EvaluatedFlagsDto } from '../../dto/feature-flag.dto';
import { EvaluateFeatureFlagsQuery } from './evaluate-feature-flags.query';

@QueryHandler(EvaluateFeatureFlagsQuery)
export class EvaluateFeatureFlagsHandler implements IQueryHandler<
  EvaluateFeatureFlagsQuery,
  EvaluatedFlagsDto
> {
  constructor(@Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepositoryPort) {}

  async execute(query: EvaluateFeatureFlagsQuery): Promise<EvaluatedFlagsDto> {
    const all = await this.flags.findAll(query.organizationId);

    const evaluated: Record<string, boolean> = {};
    for (const flag of all) {
      evaluated[flag.key] = flag.isEnabledFor(query.subjectId);
    }

    return { flags: evaluated };
  }
}
