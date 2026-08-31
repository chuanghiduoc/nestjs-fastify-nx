import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { API_KEY_REPOSITORY } from '../../../domain/ports/api-key-repository.port';
import type { ApiKeyRepositoryPort } from '../../../domain/ports/api-key-repository.port';
import { RevokeApiKeyCommand } from './revoke-api-key.command';

@CommandHandler(RevokeApiKeyCommand)
export class RevokeApiKeyHandler implements ICommandHandler<RevokeApiKeyCommand, void> {
  constructor(@Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort) {}

  // Revoking an already-revoked key is a no-op rather than a conflict: the caller's intent
  // ("this key must not work") already holds, and a retried DELETE must stay safe.
  async execute(command: RevokeApiKeyCommand): Promise<void> {
    if (await this.apiKeys.revoke(command.organizationId, command.id, new Date())) return;
    if (await this.apiKeys.exists(command.organizationId, command.id)) return;

    throw new DomainException({
      kind: 'not_found',
      code: ERROR_CODES.API_KEY_NOT_FOUND,
      title: I18N_KEYS.common.not_found,
      messageKey: I18N_KEYS.errors.api_keys.not_found,
      violations: [
        {
          path: 'id',
          code: ERROR_CODES.API_KEY_NOT_FOUND,
          message: 'API key not found',
          messageKey: I18N_KEYS.errors.api_keys.not_found,
        },
      ],
    });
  }
}
