import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';
import { ALL_PERMISSIONS } from '@nestjs-fastify-nx/shared';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable label for the key.', example: 'CI deploy bot' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description:
      'Permissions the key may exercise. Every scope must be in the catalog and must also be held by the caller — a key can never exceed its issuer.',
    isArray: true,
    enum: ALL_PERMISSIONS,
    example: ['file:read', 'file:create'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_PERMISSIONS.length)
  @IsString({ each: true })
  scopes!: string[];

  @ApiPropertyOptional({
    description: 'Optional expiry. Omit for a key that never expires.',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class ListApiKeysFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'Include revoked keys in the listing. Defaults to false.',
    type: Boolean,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeRevoked?: boolean;
}

export class ApiKeyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CI deploy bot' })
  name!: string;

  @ApiProperty({
    description: 'Non-secret leading fragment of the key, for telling keys apart in a list.',
    example: 'sk_A1b2C3d4',
  })
  prefix!: string;

  @ApiProperty({ isArray: true, enum: ALL_PERMISSIONS })
  scopes!: string[];

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  createdById!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastUsedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  expiresAt!: Date | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  revokedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class IssuedApiKeyResponseDto extends ApiKeyResponseDto {
  @ApiProperty({
    description:
      'The raw key. Returned exactly once, here, and never retrievable again — store it now.',
    example: 'sk_A1b2C3d4e5F6...',
  })
  key!: string;
}
