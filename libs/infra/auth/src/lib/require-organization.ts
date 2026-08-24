import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import type { AuthenticatedSession } from './better-auth.types';

export function requireOrganizationId(session: AuthenticatedSession): string {
  if (session.organizationId) return session.organizationId;

  throw new DomainException({
    kind: 'forbidden',
    code: ERROR_CODES.ORGANIZATION_CONTEXT_REQUIRED,
    title: 'Organization context required',
    messageKey: I18N_KEYS.errors.auth.organization_context_required,
    violations: [
      {
        path: 'session.activeOrganizationId',
        code: ERROR_CODES.ORGANIZATION_CONTEXT_REQUIRED,
        message: 'No active organization selected for this session',
        messageKey: I18N_KEYS.errors.auth.organization_context_required,
      },
    ],
  });
}
