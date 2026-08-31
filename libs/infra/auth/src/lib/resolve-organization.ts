import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import type { AuthenticatedApiKey } from './api-key.types';
import type { AuthenticatedSession } from './better-auth.types';
import { requireOrganizationId } from './require-organization';

/**
 * Tenant scope for a route reachable by both a session cookie and an API key. A key is issued
 * against exactly one organization, so it carries its own scope and never needs an active
 * organization on a session that does not exist.
 */
export function resolveOrganizationId(
  user: AuthenticatedSession | undefined,
  apiKey: AuthenticatedApiKey | undefined,
): string {
  if (apiKey) return apiKey.organizationId;
  if (user) return requireOrganizationId(user);

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
