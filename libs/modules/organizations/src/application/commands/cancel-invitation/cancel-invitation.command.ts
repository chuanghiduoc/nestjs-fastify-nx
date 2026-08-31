import { Command } from '@nestjs/cqrs';

export class CancelInvitationCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly id: string,
  ) {
    super();
  }
}
