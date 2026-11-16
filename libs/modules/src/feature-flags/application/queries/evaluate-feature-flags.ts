import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  FEATURE_FLAG_REPOSITORY,
  type FeatureFlagRepositoryPort,
} from '../../domain/ports/feature-flag-repository.port';
import type { EvaluatedFlagsDto } from '../dto/feature-flag.dto';

export class EvaluateFeatureFlagsQuery extends Query<EvaluatedFlagsDto> {
  constructor(
    readonly organizationId: string,
    /** Bucketing subject — the caller, so a partial rollout is stable per user. */
    readonly subjectId: string,
  ) {
    super();
  }
}

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
