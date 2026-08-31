import { Command } from '@nestjs/cqrs';

export class DeleteOrganizationRoleCommand extends Command<void> {
  constructor(
    readonly organizationId: string,
    readonly role: string,
  ) {
    super();
  }
}
