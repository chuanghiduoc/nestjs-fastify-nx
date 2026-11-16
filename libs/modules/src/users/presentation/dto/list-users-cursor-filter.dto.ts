import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';
import { UserStatus } from '../../domain/entities/user.entity';

export class ListUsersCursorFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Filter by organization membership role.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @ApiPropertyOptional({ enum: UserStatus, description: 'Filter by account status' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Search by name or email (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
