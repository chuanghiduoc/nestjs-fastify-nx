import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TEAM_REPOSITORY } from '../../../domain/ports/team-repository.port';
import type { TeamRepositoryPort } from '../../../domain/ports/team-repository.port';
import { teamNotFound } from '../../organization-errors';
import { DeleteTeamCommand } from './delete-team.command';

@CommandHandler(DeleteTeamCommand)
export class DeleteTeamHandler implements ICommandHandler<DeleteTeamCommand, void> {
  constructor(@Inject(TEAM_REPOSITORY) private readonly teams: TeamRepositoryPort) {}

  async execute(command: DeleteTeamCommand): Promise<void> {
    const deleted = await this.teams.delete(command.organizationId, command.id);
    if (!deleted) throw teamNotFound();
  }
}
