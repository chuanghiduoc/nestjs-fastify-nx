import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { ORGANIZATION_REPOSITORY } from './domain/ports/organization-repository.port';
import { ORGANIZATION_ROLE_REPOSITORY } from './domain/ports/organization-role-repository.port';
import { TEAM_REPOSITORY } from './domain/ports/team-repository.port';
import { INVITATION_REPOSITORY } from './domain/ports/invitation-repository.port';
import { PrismaOrganizationRepository } from './infrastructure/repositories/prisma-organization.repository';
import { PrismaOrganizationRoleRepository } from './infrastructure/repositories/prisma-organization-role.repository';
import { PrismaTeamRepository } from './infrastructure/repositories/prisma-team.repository';
import { PrismaInvitationRepository } from './infrastructure/repositories/prisma-invitation.repository';
import { GetCurrentOrganizationHandler } from './application/queries/get-current-organization/get-current-organization.handler';
import { ListOrganizationRolesHandler } from './application/queries/list-organization-roles/list-organization-roles.handler';
import { ListTeamsHandler } from './application/queries/list-teams/list-teams.handler';
import { ListInvitationsHandler } from './application/queries/list-invitations/list-invitations.handler';
import { CreateOrganizationRoleHandler } from './application/commands/create-organization-role/create-organization-role.handler';
import { UpdateOrganizationRoleHandler } from './application/commands/update-organization-role/update-organization-role.handler';
import { DeleteOrganizationRoleHandler } from './application/commands/delete-organization-role/delete-organization-role.handler';
import { CreateTeamHandler } from './application/commands/create-team/create-team.handler';
import { UpdateTeamHandler } from './application/commands/update-team/update-team.handler';
import { DeleteTeamHandler } from './application/commands/delete-team/delete-team.handler';
import { CancelInvitationHandler } from './application/commands/cancel-invitation/cancel-invitation.handler';
import { OrganizationsController } from './presentation/controllers/organizations.controller';
import { OrganizationRolesController } from './presentation/controllers/organization-roles.controller';
import { TeamsController } from './presentation/controllers/teams.controller';
import { InvitationsController } from './presentation/controllers/invitations.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [
    OrganizationsController,
    OrganizationRolesController,
    TeamsController,
    InvitationsController,
  ],
  providers: [
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
  exports: [ORGANIZATION_ROLE_REPOSITORY],
})
export class OrganizationsModule {}
