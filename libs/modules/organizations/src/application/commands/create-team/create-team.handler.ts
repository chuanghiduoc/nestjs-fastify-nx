import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TEAM_REPOSITORY } from '../../../domain/ports/team-repository.port';
import type { TeamRepositoryPort } from '../../../domain/ports/team-repository.port';
import { Team } from '../../../domain/entities/team.entity';
import type { TeamDto } from '../../dto/organization-role.dto';
import { CreateTeamCommand } from './create-team.command';

@CommandHandler(CreateTeamCommand)
export class CreateTeamHandler implements ICommandHandler<CreateTeamCommand, TeamDto> {
  constructor(@Inject(TEAM_REPOSITORY) private readonly teams: TeamRepositoryPort) {}

  async execute(command: CreateTeamCommand): Promise<TeamDto> {
    const team = Team.create({ organizationId: command.organizationId, name: command.name });

    await this.teams.create(team);

    return {
      id: team.id,
      name: team.name,
      memberCount: 0,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  }
}
