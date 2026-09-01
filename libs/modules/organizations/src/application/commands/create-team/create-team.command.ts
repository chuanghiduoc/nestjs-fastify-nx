import { Command } from '@nestjs/cqrs';
import type { TeamDto } from '../../dto/organization-role.dto';

export class CreateTeamCommand extends Command<TeamDto> {
  constructor(
    readonly organizationId: string,
    readonly name: string,
  ) {
    super();
  }
}
