import type { FeatureFlag } from '../../domain/entities/feature-flag.entity';

export interface FeatureFlagDto {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EvaluatedFlagsDto {
  flags: Record<string, boolean>;
}

export function toFeatureFlagDto(flag: FeatureFlag): FeatureFlagDto {
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
