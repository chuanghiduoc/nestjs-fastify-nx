import { Command } from '@nestjs/cqrs';

export class CreateTeamCommand extends Command<TeamDto> {
  constructor(
    readonly organizationId: string,
    readonly name: string,
  ) {
    super();
  }
}
import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TEAM_REPOSITORY } from './team-repository.port';
import type { TeamRepositoryPort } from './team-repository.port';
import { Team } from './team.entity';
import { toTeamDto, type TeamDto } from './organization-role-application.dto';

const NO_MEMBERS_YET = 0;

@CommandHandler(CreateTeamCommand)
export class CreateTeamHandler implements ICommandHandler<CreateTeamCommand, TeamDto> {
  constructor(@Inject(TEAM_REPOSITORY) private readonly teams: TeamRepositoryPort) {}

  async execute(command: CreateTeamCommand): Promise<TeamDto> {
    const team = Team.create({ organizationId: command.organizationId, name: command.name });

    await this.teams.create(team);

    return toTeamDto(team, NO_MEMBERS_YET);
  }
}
