import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { INVITATION_REPOSITORY } from '../../../domain/ports/invitation-repository.port';
import type { InvitationRepositoryPort } from '../../../domain/ports/invitation-repository.port';
import { invitationNotFound, invitationNotPending } from '../../organization-errors';
import { CancelInvitationCommand } from './cancel-invitation.command';

@CommandHandler(CancelInvitationCommand)
export class CancelInvitationHandler implements ICommandHandler<CancelInvitationCommand, void> {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepositoryPort,
  ) {}

  async execute(command: CancelInvitationCommand): Promise<void> {
    if (await this.invitations.cancelPending(command.organizationId, command.id)) return;

    const existing = await this.invitations.findById(command.organizationId, command.id);
    if (!existing) throw invitationNotFound();
    throw invitationNotPending();
  }
}
