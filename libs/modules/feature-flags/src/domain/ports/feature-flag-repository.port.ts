import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { FeatureFlag } from '../entities/feature-flag.entity';

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
  update(flag: FeatureFlag): Promise<void>;
  delete(organizationId: string, id: string): Promise<boolean>;
}
