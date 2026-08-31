import { Command } from '@nestjs/cqrs';
import type { FeatureFlagDto } from '../../dto/feature-flag.dto';

export interface UpdateFeatureFlagInput {
  readonly organizationId: string;
  readonly id: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;
}

export class UpdateFeatureFlagCommand extends Command<FeatureFlagDto> {
  readonly organizationId: string;
  readonly id: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;

  constructor(input: UpdateFeatureFlagInput) {
    super();
    this.organizationId = input.organizationId;
    this.id = input.id;
    this.description = input.description;
    this.enabled = input.enabled;
    this.rolloutPercentage = input.rolloutPercentage;
  }
}
