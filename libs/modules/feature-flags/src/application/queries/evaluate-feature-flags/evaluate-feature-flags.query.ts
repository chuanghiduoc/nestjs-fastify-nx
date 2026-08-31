import { Query } from '@nestjs/cqrs';
import type { EvaluatedFlagsDto } from '../../dto/feature-flag.dto';

export class EvaluateFeatureFlagsQuery extends Query<EvaluatedFlagsDto> {
  constructor(
    readonly organizationId: string,
    /** Bucketing subject — the caller, so a partial rollout is stable per user. */
    readonly subjectId: string,
  ) {
    super();
  }
}
