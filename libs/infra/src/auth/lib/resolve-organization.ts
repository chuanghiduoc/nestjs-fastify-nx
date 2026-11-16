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
  return apiKey?.organizationId ?? requireOrganizationId(user);
}
