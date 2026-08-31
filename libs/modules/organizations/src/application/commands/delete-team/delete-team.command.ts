import { Command } from '@nestjs/cqrs';

export class DeleteTeamCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly id: string,
  ) {
    super();
  }
}
