import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra/database';
import { ORGANIZATION_REPOSITORY } from './domain/ports/organization-repository.port';
import { ORGANIZATION_ROLE_REPOSITORY } from './domain/ports/organization-role-repository.port';
import { TEAM_REPOSITORY } from './domain/ports/team-repository.port';
import { INVITATION_REPOSITORY } from './domain/ports/invitation-repository.port';
import { PrismaOrganizationRepository } from './infrastructure/repositories/prisma-organization.repository';
import { PrismaOrganizationRoleRepository } from './infrastructure/repositories/prisma-organization-role.repository';
import { PrismaTeamRepository } from './infrastructure/repositories/prisma-team.repository';
import { PrismaInvitationRepository } from './infrastructure/repositories/prisma-invitation.repository';
import { GetCurrentOrganizationHandler } from './application/queries/get-current-organization';
import { ListOrganizationRolesHandler } from './application/queries/list-organization-roles';
import { ListTeamsHandler } from './application/queries/list-teams';
import { ListInvitationsHandler } from './application/queries/list-invitations';
import { CreateOrganizationRoleHandler } from './application/commands/create-organization-role';
import { UpdateOrganizationRoleHandler } from './application/commands/update-organization-role';
import { DeleteOrganizationRoleHandler } from './application/commands/delete-organization-role';
import { CreateTeamHandler } from './application/commands/create-team';
import { UpdateTeamHandler } from './application/commands/update-team';
import { DeleteTeamHandler } from './application/commands/delete-team';
import { CancelInvitationHandler } from './application/commands/cancel-invitation';
import { OrganizationsController } from './presentation/controllers/organizations.controller';
import { OrganizationRolesController } from './presentation/controllers/organization-roles.controller';
import { TeamsController } from './presentation/controllers/teams.controller';
import { InvitationsController } from './presentation/controllers/invitations.controller';
import { PERSONAL_ORGANIZATION_REPOSITORY } from './domain/ports/personal-organization-repository.port';
import { PrismaPersonalOrganizationRepository } from './infrastructure/repositories/prisma-personal-organization.repository';
import { EnsurePersonalOrganizationHandler } from './application/commands/ensure-personal-organization';

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
