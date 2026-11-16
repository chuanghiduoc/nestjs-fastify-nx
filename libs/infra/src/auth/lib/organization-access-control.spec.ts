import { describe, expect, it } from 'vitest';
import { organizationRoles } from './organization-access-control';

describe('organizationAccessControl role definitions', () => {
  it('grants full access control management (create, read, update, delete) to owner role', () => {
    const ownerRole = organizationRoles.owner as { statements?: Record<string, string[]> };
    expect(ownerRole.statements?.['ac']).toEqual(['create', 'read', 'update', 'delete']);
  });

  it('restricts access control management to read-only for admin role to prevent privilege escalation', () => {
    const adminRole = organizationRoles.admin as { statements?: Record<string, string[]> };
    expect(adminRole.statements?.['ac']).toEqual(['read']);
  });

  it('does not grant access control management to member, billing, or viewer roles', () => {
    const memberRole = organizationRoles.member as { statements?: Record<string, string[]> };
    const billingRole = organizationRoles.billing as { statements?: Record<string, string[]> };
    const viewerRole = organizationRoles.viewer as { statements?: Record<string, string[]> };

    expect(memberRole.statements?.['ac']).toBeUndefined();
    expect(billingRole.statements?.['ac']).toBeUndefined();
    expect(viewerRole.statements?.['ac']).toBeUndefined();
  });
});
