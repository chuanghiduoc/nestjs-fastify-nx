import { Command } from '@nestjs/cqrs';

export interface MarkAllNotificationsReadResult {
  marked: number;
}

export class MarkAllNotificationsReadCommand extends Command<MarkAllNotificationsReadResult> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
  ) {
    super();
  }
}
