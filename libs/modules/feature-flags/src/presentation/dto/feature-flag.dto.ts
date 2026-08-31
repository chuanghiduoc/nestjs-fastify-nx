import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const KEY_PATTERN = /^[a-z][a-z0-9._-]{1,99}$/;

export class CreateFeatureFlagDto {
  @ApiProperty({
    description: 'Stable key the client checks. Unique within the organization.',
    example: 'checkout.new-flow',
  })
  @IsString()
  @Matches(KEY_PATTERN)
  key!: string;

  @ApiPropertyOptional({ description: 'What the flag controls.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Master switch. Defaults to false.', default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Share of subjects the flag is on for, 0–100. Bucketing is deterministic per subject, so a subject does not flip between requests. Defaults to 100.',
    minimum: 0,
    maximum: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;
}

export class UpdateFeatureFlagDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;
}

export class FeatureFlagResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'checkout.new-flow' })
  key!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ minimum: 0, maximum: 100, example: 25 })
  rolloutPercentage!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class EvaluatedFlagsResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    description: 'Every flag in the organization, resolved for the calling subject.',
    example: { 'checkout.new-flow': true },
  })
  flags!: Record<string, boolean>;
}
