import { Query } from '@nestjs/cqrs';
import type { FeatureFlagDto } from '../../dto/feature-flag.dto';

export interface ListFeatureFlagsResult {
  data: FeatureFlagDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export class ListFeatureFlagsQuery extends Query<ListFeatureFlagsResult> {
  constructor(
    readonly organizationId: string,
    readonly limit: number,
    readonly startingAfter?: string,
  ) {
    super();
  }
}
