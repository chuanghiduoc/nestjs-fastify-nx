import { Command } from '@nestjs/cqrs';

export class RevokeSessionCommand extends Command<void> {
  constructor(
    readonly userId: string,
    readonly id: string,
  ) {
    super();
  }
}
