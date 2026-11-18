import { Command } from '@nestjs/cqrs';

export class UpdateTeamCommand extends Command<TeamDto> {
  constructor(
    readonly organizationId: string,
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }
}
import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TEAM_REPOSITORY } from '../../domain/ports/team-repository.port';
import type {
  TeamRepositoryPort,
  TeamUpdateOutcome,
} from '../../domain/ports/team-repository.port';
import { toTeamDto, type TeamDto } from '../dto/organization-role-application.dto';
import { teamChangedConcurrently, teamNotFound } from '../organization-errors';

function assertTeamUpdated(outcome: TeamUpdateOutcome): void {
  switch (outcome) {
    case 'updated':
      return;
    case 'not_found':
      throw teamNotFound();
    case 'stale':
      throw teamChangedConcurrently();
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled team update outcome: ${String(unhandled)}`);
    }
  }
}

@CommandHandler(UpdateTeamCommand)
export class UpdateTeamHandler implements ICommandHandler<UpdateTeamCommand, TeamDto> {
  constructor(@Inject(TEAM_REPOSITORY) private readonly teams: TeamRepositoryPort) {}

  async execute(command: UpdateTeamCommand): Promise<TeamDto> {
    const existing = await this.teams.findById(command.organizationId, command.id);
    if (!existing) throw teamNotFound();

    const renamed = existing.renamedTo(command.name);
    assertTeamUpdated(await this.teams.update(renamed));

    return toTeamDto(renamed, existing.memberCount);
  }
}
