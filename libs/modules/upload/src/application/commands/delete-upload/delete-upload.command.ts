import { Command } from '@nestjs/cqrs';

export class DeleteUploadCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
    readonly fileId: string,
  ) {
    super();
  }
}
