import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  RESOURCE_TYPES,
  SYSTEM_ROLE_PERMISSIONS,
} from '@nestjs-fastify-nx/shared';
import type { Principal } from '@nestjs-fastify-nx/core';
import {
  DENIAL_REASONS,
  MEMBERSHIP_INDEPENDENT_PERMISSIONS,
  decideAccess,
  decideFilter,
  decideWithoutOrganization,
  requiresMembership,
  scopeOf,
  type PolicyContext,
} from './access-policy';

const organizationId = randomUUID();
const userId = randomUUID();

const user: Principal = { type: 'user', userId, organizationId };

function removedMember(): PolicyContext {
  return { principal: user, permissions: [], isMember: false };
}

describe('scopeOf / requiresMembership', () => {
  it('classifies every catalogued permission', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(['organization', 'organization_self', 'self', 'global']).toContain(
        scopeOf(permission),
      );
    }
  });

  it('requires membership only for tenant-bound scopes', () => {
    expect(requiresMembership(PERMISSIONS.FILE_READ)).toBe(true);
    expect(requiresMembership(PERMISSIONS.NOTIFICATION_READ)).toBe(true);
    expect(requiresMembership(PERMISSIONS.SESSION_READ)).toBe(false);
    expect(requiresMembership(PERMISSIONS.TERM_READ)).toBe(false);
  });

  it('keeps the membership-independent grant inside every system role', () => {
    for (const permissions of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
      for (const permission of MEMBERSHIP_INDEPENDENT_PERMISSIONS) {
        expect(permissions).toContain(permission);
      }
    }
  });

  it('never marks a tenant-bound permission as membership-independent', () => {
    for (const permission of MEMBERSHIP_INDEPENDENT_PERMISSIONS) {
      expect(requiresMembership(permission)).toBe(false);
    }
  });
});

describe('decideAccess for a caller who is no longer a member', () => {
  it('still grants self-service permissions', () => {
    const decisions = decideAccess(removedMember(), [
      { permission: PERMISSIONS.SESSION_READ },
      { permission: PERMISSIONS.SESSION_REVOKE },
      { permission: PERMISSIONS.TERM_READ },
      { permission: PERMISSIONS.TERM_ACCEPT },
    ]);
    expect(decisions.every((decision) => decision.allowed)).toBe(true);
  });

  it('still fails closed on tenant-bound permissions', () => {
    const decisions = decideAccess(removedMember(), [
      { permission: PERMISSIONS.FILE_READ },
      { permission: PERMISSIONS.NOTIFICATION_READ },
    ]);
    expect(decisions).toEqual([
      { allowed: false, reason: DENIAL_REASONS.notAMember },
      { allowed: false, reason: DENIAL_REASONS.notAMember },
    ]);
  });

  it('does not turn a global permission into a universal grant', () => {
    const [decision] = decideAccess(removedMember(), [{ permission: PERMISSIONS.TERM_MANAGE }]);
    expect(decision).toEqual({ allowed: false, reason: DENIAL_REASONS.permissionNotGranted });
  });

  it('does not extend the owner-scoped grant to a resource the caller owns', () => {
    const [decision] = decideAccess(removedMember(), [
      {
        permission: PERMISSIONS.FILE_DELETE,
        resource: { type: RESOURCE_TYPES.FILE, id: randomUUID(), organizationId, ownerId: userId },
      },
    ]);
    expect(decision.allowed).toBe(false);
  });
});

describe('decideAccess for an api key', () => {
  it('never receives the membership-independent grant', () => {
    const scopes = [PERMISSIONS.FILE_READ];
    const principal: Principal = {
      type: 'api_key',
      apiKeyId: randomUUID(),
      organizationId,
      scopes,
    };
    const [decision] = decideAccess({ principal, permissions: scopes, isMember: true }, [
      { permission: PERMISSIONS.SESSION_READ },
    ]);
    expect(decision.allowed).toBe(false);
  });
});

describe('decideFilter for a caller who is no longer a member', () => {
  it('scopes a self resource to the caller', () => {
    expect(decideFilter(removedMember(), PERMISSIONS.SESSION_READ, RESOURCE_TYPES.SESSION)).toEqual(
      { kind: 'predicate', where: { userId } },
    );
  });

  it('opens a global resource', () => {
    expect(decideFilter(removedMember(), PERMISSIONS.TERM_READ, RESOURCE_TYPES.TERM)).toEqual({
      kind: 'all',
    });
  });

  it('blocks tenant-bound resources entirely', () => {
    expect(decideFilter(removedMember(), PERMISSIONS.FILE_READ, RESOURCE_TYPES.FILE)).toEqual({
      kind: 'none',
    });
    expect(
      decideFilter(removedMember(), PERMISSIONS.NOTIFICATION_READ, RESOURCE_TYPES.NOTIFICATION),
    ).toEqual({ kind: 'none' });
  });
});

describe('decideWithoutOrganization', () => {
  it('grants only the membership-independent permissions', () => {
    expect(
      decideWithoutOrganization([
        PERMISSIONS.SESSION_READ,
        PERMISSIONS.TERM_MANAGE,
        PERMISSIONS.FILE_READ,
      ]),
    ).toEqual([
      { allowed: true },
      { allowed: false, reason: DENIAL_REASONS.permissionNotGranted },
      { allowed: false, reason: DENIAL_REASONS.permissionNotGranted },
    ]);
  });
});
