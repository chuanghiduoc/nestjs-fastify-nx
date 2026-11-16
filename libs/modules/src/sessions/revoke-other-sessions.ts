import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from './session-repository.port';

export interface RevokedSessionsDto {
  revoked: number;
}

export class RevokeOtherSessionsCommand extends Command<RevokedSessionsDto> {
  constructor(
    readonly userId: string,
    readonly currentSessionId: string,
  ) {
    super();
  }
}

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
