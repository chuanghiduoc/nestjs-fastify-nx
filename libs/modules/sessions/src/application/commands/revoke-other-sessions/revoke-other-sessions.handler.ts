import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SESSION_REPOSITORY } from '../../../domain/ports/session-repository.port';
import type { SessionRepositoryPort } from '../../../domain/ports/session-repository.port';
import type { RevokedSessionsDto } from '../../dto/session.dto';
import { RevokeOtherSessionsCommand } from './revoke-other-sessions.command';

@CommandHandler(RevokeOtherSessionsCommand)
export class RevokeOtherSessionsHandler implements ICommandHandler<
  RevokeOtherSessionsCommand,
  RevokedSessionsDto
> {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort) {}

  async execute(command: RevokeOtherSessionsCommand): Promise<RevokedSessionsDto> {
    return {
      revoked: await this.sessions.deleteAllForUserExcept(command.userId, command.currentSessionId),
    };
  }
}
