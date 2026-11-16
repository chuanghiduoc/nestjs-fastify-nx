import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';

export class ListAuditLogsCursorFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'Exact domain event name to filter by, e.g. `users.registered`.',
    example: 'users.registered',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  action?: string;

  @ApiPropertyOptional({
    description: 'Exact resource label to filter by, e.g. `user` or `organization`.',
    example: 'user',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  resource?: string;

  @ApiPropertyOptional({
    description: 'Restrict to entries recorded for a single acting user (UUID v7).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('7')
  userId?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on when the entry was recorded (ISO 8601).',
    type: String,
    format: 'date-time',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredFrom?: Date;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on when the entry was recorded (ISO 8601).',
    type: String,
    format: 'date-time',
    example: '2026-08-31T23:59:59.999Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredUntil?: Date;
}
