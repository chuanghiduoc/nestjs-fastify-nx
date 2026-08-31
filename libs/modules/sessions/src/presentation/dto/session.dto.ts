import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';

export class ListSessionsFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'Hide sessions that have already expired. Defaults to true.',
    type: Boolean,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value !== false && value !== 'false')
  @IsBoolean()
  activeOnly?: boolean;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: '203.0.113.42' })
  ipAddress!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'User agent captured at sign-in.' })
  userAgent!: string | null;

  @ApiProperty({ description: 'True for the session making this request.' })
  current!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class RevokedSessionsResponseDto {
  @ApiProperty({ description: 'How many other sessions were signed out.', example: 2 })
  revoked!: number;
}
