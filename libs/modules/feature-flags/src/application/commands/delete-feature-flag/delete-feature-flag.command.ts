import { Command } from '@nestjs/cqrs';

export class DeleteFeatureFlagCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly id: string,
  ) {
    super();
  }
}
