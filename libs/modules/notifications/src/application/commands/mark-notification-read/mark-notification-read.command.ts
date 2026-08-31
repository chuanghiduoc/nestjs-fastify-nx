import { Command } from '@nestjs/cqrs';

export class MarkNotificationReadCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
    readonly id: string,
  ) {
    super();
  }
}
