import type { Permission } from '@nestjs-fastify-nx/shared';

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
