import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { FeatureFlag, FeatureFlagChanges } from '../entities/feature-flag.entity';

export const FEATURE_FLAG_REPOSITORY = Symbol('FEATURE_FLAG_REPOSITORY');

export interface FindFeatureFlagsCursorOptions {
  organizationId: string;
  startingAfter?: DecodedCursor;
  limit: number;
}

export interface FindFeatureFlagsCursorResult {
  items: FeatureFlag[];
  hasMore: boolean;
}

export interface FeatureFlagRepositoryPort {
  findAllCursor(options: FindFeatureFlagsCursorOptions): Promise<FindFeatureFlagsCursorResult>;
  findAll(organizationId: string): Promise<FeatureFlag[]>;
  findById(organizationId: string, id: string): Promise<FeatureFlag | null>;
  create(flag: FeatureFlag): Promise<void>;
  update(
    organizationId: string,
    id: string,
    changes: FeatureFlagChanges,
    updatedAt: Date,
  ): Promise<boolean>;
  delete(organizationId: string, id: string): Promise<boolean>;
}
