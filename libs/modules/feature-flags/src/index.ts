export { FeatureFlagsModule } from './feature-flags.module';

export { FeatureFlag } from './domain/entities/feature-flag.entity';
export {
  ListFeatureFlagsQuery,
  type ListFeatureFlagsResult,
} from './application/queries/list-feature-flags/list-feature-flags.query';
export { EvaluateFeatureFlagsQuery } from './application/queries/evaluate-feature-flags/evaluate-feature-flags.query';
export { CreateFeatureFlagCommand } from './application/commands/create-feature-flag/create-feature-flag.command';
export { UpdateFeatureFlagCommand } from './application/commands/update-feature-flag/update-feature-flag.command';
export { DeleteFeatureFlagCommand } from './application/commands/delete-feature-flag/delete-feature-flag.command';
export type { EvaluatedFlagsDto, FeatureFlagDto } from './application/dto/feature-flag.dto';
export {
  CreateFeatureFlagDto,
  EvaluatedFlagsResponseDto,
  FeatureFlagResponseDto,
  UpdateFeatureFlagDto,
} from './presentation/dto/feature-flag.dto';
