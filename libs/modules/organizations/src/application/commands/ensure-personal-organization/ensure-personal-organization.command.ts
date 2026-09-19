import { Command } from '@nestjs/cqrs';

export class EnsurePersonalOrganizationCommand extends Command<string> {
  constructor(readonly userId: string) {
    super();
  }
}
