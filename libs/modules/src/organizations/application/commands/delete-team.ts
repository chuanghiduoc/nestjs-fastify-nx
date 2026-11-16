import { Command } from '@nestjs/cqrs';

export class DeleteTeamCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly id: string,
  ) {
    super();
  }
}
import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TEAM_REPOSITORY } from '../../domain/ports/team-repository.port';
import type { TeamRepositoryPort } from '../../domain/ports/team-repository.port';
import { teamNotFound } from '../organization-errors';

@CommandHandler(DeleteTeamCommand)
export class DeleteTeamHandler implements ICommandHandler<DeleteTeamCommand, void> {
  constructor(@Inject(TEAM_REPOSITORY) private readonly teams: TeamRepositoryPort) {}

  async execute(command: DeleteTeamCommand): Promise<void> {
    const deleted = await this.teams.delete(command.organizationId, command.id);
    if (!deleted) throw teamNotFound();
  }
}
