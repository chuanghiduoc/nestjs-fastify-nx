import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { ORGANIZATION_REPOSITORY } from './organization-repository.port';
import { ORGANIZATION_ROLE_REPOSITORY } from './organization-role-repository.port';
import { TEAM_REPOSITORY } from './team-repository.port';
import { INVITATION_REPOSITORY } from './invitation-repository.port';
import { PrismaOrganizationRepository } from './prisma-organization.repository';
import { PrismaOrganizationRoleRepository } from './prisma-organization-role.repository';
import { PrismaTeamRepository } from './prisma-team.repository';
import { PrismaInvitationRepository } from './prisma-invitation.repository';
import { GetCurrentOrganizationHandler } from './get-current-organization';
import { ListOrganizationRolesHandler } from './list-organization-roles';
import { ListTeamsHandler } from './list-teams';
import { ListInvitationsHandler } from './list-invitations';
import { CreateOrganizationRoleHandler } from './create-organization-role';
import { UpdateOrganizationRoleHandler } from './update-organization-role';
import { DeleteOrganizationRoleHandler } from './delete-organization-role';
import { CreateTeamHandler } from './create-team';
import { UpdateTeamHandler } from './update-team';
import { DeleteTeamHandler } from './delete-team';
import { CancelInvitationHandler } from './cancel-invitation';
import { OrganizationsController } from './organizations.controller';
import { OrganizationRolesController } from './organization-roles.controller';
import { TeamsController } from './teams.controller';
import { InvitationsController } from './invitations.controller';
import { PERSONAL_ORGANIZATION_REPOSITORY } from './personal-organization-repository.port';
import { PrismaPersonalOrganizationRepository } from './prisma-personal-organization.repository';
import { EnsurePersonalOrganizationHandler } from './ensure-personal-organization';

@Module({
  imports: [DatabaseModule],
  controllers: [
    OrganizationsController,
    OrganizationRolesController,
    TeamsController,
    InvitationsController,
  ],
  providers: [
    { provide: PERSONAL_ORGANIZATION_REPOSITORY, useClass: PrismaPersonalOrganizationRepository },
    EnsurePersonalOrganizationHandler,
    { provide: ORGANIZATION_REPOSITORY, useClass: PrismaOrganizationRepository },
    { provide: ORGANIZATION_ROLE_REPOSITORY, useClass: PrismaOrganizationRoleRepository },
    { provide: TEAM_REPOSITORY, useClass: PrismaTeamRepository },
    { provide: INVITATION_REPOSITORY, useClass: PrismaInvitationRepository },
    GetCurrentOrganizationHandler,
    ListOrganizationRolesHandler,
    ListTeamsHandler,
    ListInvitationsHandler,
    CreateOrganizationRoleHandler,
    UpdateOrganizationRoleHandler,
    DeleteOrganizationRoleHandler,
    CreateTeamHandler,
    UpdateTeamHandler,
    DeleteTeamHandler,
    CancelInvitationHandler,
  ],
})
export class OrganizationsModule {}
