import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TERM_TYPES } from '../../domain/entities/term.entity';

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,49}$/;

export class CreateTermDto {
  @ApiProperty({ enum: TERM_TYPES, description: 'Which legal document this is.' })
  @IsIn(TERM_TYPES)
  type!: (typeof TERM_TYPES)[number];

  @ApiProperty({ description: 'Version label, unique per type.', example: '2026-08-01' })
  @IsString()
  @Matches(VERSION_PATTERN)
  version!: string;

  @ApiProperty({ description: 'Document body.' })
  @IsString()
  @MaxLength(1_000_000)
  content!: string;

  @ApiPropertyOptional({
    description: 'Publish immediately. An unpublished version cannot be accepted.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class TermResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TERM_TYPES })
  type!: string;

  @ApiProperty({ example: '2026-08-01' })
  version!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class TermAcceptanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  termId!: string;

  @ApiProperty({ enum: TERM_TYPES })
  type!: string;

  @ApiProperty({ example: '2026-08-01' })
  version!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  acceptedAt!: Date;
}
