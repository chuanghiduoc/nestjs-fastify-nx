import { Command } from '@nestjs/cqrs';

export class RevokeApiKeyCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
    readonly id: string,
  ) {
    super();
  }
}
