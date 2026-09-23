import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TEAM_REPOSITORY } from '../../../domain/ports/team-repository.port';
import type { TeamRepositoryPort } from '../../../domain/ports/team-repository.port';
import { toTeamDto, type TeamDto } from '../../dto/organization-role.dto';
import { teamNotFound } from '../../organization-errors';
import { UpdateTeamCommand } from './update-team.command';

@CommandHandler(UpdateTeamCommand)
export class UpdateTeamHandler implements ICommandHandler<UpdateTeamCommand, TeamDto> {
  constructor(@Inject(TEAM_REPOSITORY) private readonly teams: TeamRepositoryPort) {}

  async execute(command: UpdateTeamCommand): Promise<TeamDto> {
    const existing = await this.teams.findById(command.organizationId, command.id);
    if (!existing) throw teamNotFound();

    const renamed = existing.renamedTo(command.name);
    if (!(await this.teams.update(renamed))) throw teamNotFound();

    return toTeamDto(renamed, existing.memberCount);
  }
}
