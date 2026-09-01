import { Command } from '@nestjs/cqrs';
import type { FeatureFlagDto } from '../../dto/feature-flag.dto';

export interface CreateFeatureFlagInput {
  readonly organizationId: string;
  readonly key: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;
}

export class CreateFeatureFlagCommand extends Command<FeatureFlagDto> {
  readonly organizationId: string;
  readonly key: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;

  constructor(input: CreateFeatureFlagInput) {
    super();
    this.organizationId = input.organizationId;
    this.key = input.key;
    this.description = input.description;
    this.enabled = input.enabled;
    this.rolloutPercentage = input.rolloutPercentage;
  }
}
