import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';
import { ALL_PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { INVITATION_STATUSES } from '../../domain/ports/invitation-repository.port';

const MAX_PERMISSIONS_PER_ROLE = ALL_PERMISSIONS.length;

export class CreateOrganizationRoleDto {
  @ApiProperty({
    description: 'Role name, unique within the organization. Cannot shadow a system role.',
    example: 'auditor',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  role!: string;

  @ApiProperty({
    description: 'Permissions the role grants. Every value must exist in the permission catalog.',
    isArray: true,
    enum: ALL_PERMISSIONS,
    example: ['audit_log:read', 'member:read'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PERMISSIONS_PER_ROLE)
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateOrganizationRoleDto {
  @ApiProperty({
    description: 'Replacement permission set — this is a full replace, not a merge.',
    isArray: true,
    enum: ALL_PERMISSIONS,
    example: ['audit_log:read'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PERMISSIONS_PER_ROLE)
  @IsString({ each: true })
  permissions!: string[];
}

export class OrganizationRoleResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Row id for a tenant-defined role; null for a built-in system role.',
  })
  id!: string | null;

  @ApiProperty({ description: 'Role name.', example: 'auditor' })
  role!: string;

  @ApiProperty({ description: 'True for the built-in roles that ship with the product.' })
  system!: boolean;

  @ApiProperty({ isArray: true, enum: ALL_PERMISSIONS, description: 'Permissions granted.' })
  permissions!: string[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  createdAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: Date | null;
}

export class CreateTeamDto {
  @ApiProperty({ description: 'Team name, unique within the organization.', example: 'Platform' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdateTeamDto extends CreateTeamDto {}

export class TeamResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Platform' })
  name!: string;

  @ApiProperty({ description: 'Number of members assigned to the team.', example: 4 })
  memberCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: Date | null;
}

export class ListTeamsFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring match on the team name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListInvitationsFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: INVITATION_STATUSES, description: 'Filter by invitation status.' })
  @IsOptional()
  @IsIn(INVITATION_STATUSES)
  status?: (typeof INVITATION_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Filter by the invited email address.' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  @Type(() => String)
  email?: string;
}

export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'invitee@example.com' })
  email!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Role the invitee will receive.' })
  role!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  teamId!: string | null;

  @ApiProperty({ enum: INVITATION_STATUSES })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({ format: 'uuid', description: 'User who sent the invitation.' })
  inviterId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class OrganizationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Acme Inc' })
  name!: string;

  @ApiProperty({ example: 'acme-inc' })
  slug!: string;

  @ApiProperty({ type: String, nullable: true })
  logo!: string | null;

  @ApiProperty({ example: 12 })
  memberCount!: number;

  @ApiProperty({ example: 3 })
  teamCount!: number;

  @ApiProperty({ example: 2 })
  pendingInvitationCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
