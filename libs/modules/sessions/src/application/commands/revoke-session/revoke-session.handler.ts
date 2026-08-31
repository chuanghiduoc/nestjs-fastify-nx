import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { SESSION_REPOSITORY } from '../../../domain/ports/session-repository.port';
import type { SessionRepositoryPort } from '../../../domain/ports/session-repository.port';
import { RevokeSessionCommand } from './revoke-session.command';

@CommandHandler(RevokeSessionCommand)
export class RevokeSessionHandler implements ICommandHandler<RevokeSessionCommand, void> {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort) {}

  // Scoped to the caller's own sessions, so a session belonging to someone else answers 404 rather
  // than 403 — a distinguishable 403 would confirm that the id exists.
  async execute(command: RevokeSessionCommand): Promise<void> {
    if (await this.sessions.deleteForUser(command.userId, command.id)) return;

    throw new DomainException({
      kind: 'not_found',
      code: ERROR_CODES.SESSION_NOT_FOUND,
      title: I18N_KEYS.common.not_found,
      messageKey: I18N_KEYS.errors.sessions.not_found,
      violations: [
        {
          path: 'id',
          code: ERROR_CODES.SESSION_NOT_FOUND,
          message: 'Session not found',
          messageKey: I18N_KEYS.errors.sessions.not_found,
        },
      ],
    });
  }
}
