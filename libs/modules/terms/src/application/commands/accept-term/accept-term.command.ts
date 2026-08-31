import { Command } from '@nestjs/cqrs';

export class AcceptTermCommand extends Command<void> {
  constructor(
    readonly userId: string,
    readonly termId: string,
    readonly ipAddress: string | null,
  ) {
    super();
  }
}
