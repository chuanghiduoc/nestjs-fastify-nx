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
