import { Command } from '@nestjs/cqrs';
import type { TeamDto } from '../../dto/organization-role.dto';

export class UpdateTeamCommand extends Command<TeamDto> {
  constructor(
    readonly organizationId: string,
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }
}
