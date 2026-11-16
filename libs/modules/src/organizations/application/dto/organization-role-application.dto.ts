import type { Permission } from '@nestjs-fastify-nx/shared';
import type { OrganizationRole } from '../../domain/entities/organization-role.entity';
import type { Team } from '../../domain/entities/team.entity';

export interface OrganizationRoleDto {
  id: string | null;
  role: string;
  system: boolean;
  permissions: readonly Permission[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface TeamDto {
  id: string;
  name: string;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: string | null;
  teamId: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
  createdAt: Date;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  memberCount: number;
  teamCount: number;
  pendingInvitationCount: number;
  createdAt: Date;
}

export function toRoleDto(role: OrganizationRole): OrganizationRoleDto {
  return {
    id: role.id,
    role: role.role,
    system: false,
    permissions: role.permissions,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export function toTeamDto(team: Team, memberCount: number): TeamDto {
  return {
    id: team.id,
    name: team.name,
    memberCount,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}
