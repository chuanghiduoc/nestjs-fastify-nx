import { describe, it, expect, beforeEach } from 'vitest';
import { PERMISSIONS, RESOURCE_TYPES, SYSTEM_ROLES } from '@nestjs-fastify-nx/shared';
import { applyAccessFilter, type AuthorizationPort, type Principal } from '@nestjs-fastify-nx/core';

export const CONFORMANCE_IDS = {
  orgA: '019dd1a5-9235-70db-8d57-54ef90100001',
  orgB: '019dd1a5-9235-70db-8d57-54ef90100002',
  owner: '019dd1a5-9235-70db-8d57-54ef90100003',
  member: '019dd1a5-9235-70db-8d57-54ef90100004',
  viewer: '019dd1a5-9235-70db-8d57-54ef90100005',
  outsider: '019dd1a5-9235-70db-8d57-54ef90100006',
  file: '019dd1a5-9235-70db-8d57-54ef90100007',
} as const;

export interface ConformanceHarness {
  readonly name: string;
  create(): Promise<{
    authorization: AuthorizationPort;
    /** Registers `userId` in `organizationId` holding `roles`. */
    grantRoles(organizationId: string, userId: string, roles: readonly string[]): Promise<void>;
    /** Defines a tenant-defined role carrying `permissions`. */
    defineCustomRole(
      organizationId: string,
      role: string,
      permissions: readonly string[],
    ): Promise<void>;
    teardown?(): Promise<void>;
  }>;
}

function userPrincipal(userId: string, organizationId: string): Principal {
  return { type: 'user', userId, organizationId };
}

/**
 * One behavioural suite every AuthorizationPort implementation must pass. A new engine is "done"
 * when it is green here — that is the guarantee ADR-0002 makes about swapping engines.
 */
export function describeAuthorizationConformance(harness: ConformanceHarness): void {
  describe(`AuthorizationPort conformance — ${harness.name}`, () => {
    let ctx: Awaited<ReturnType<ConformanceHarness['create']>>;
    let authorization: AuthorizationPort;

    beforeEach(async () => {
      ctx = await harness.create();
      authorization = ctx.authorization;
      await ctx.grantRoles(CONFORMANCE_IDS.orgA, CONFORMANCE_IDS.owner, [SYSTEM_ROLES.OWNER]);
      await ctx.grantRoles(CONFORMANCE_IDS.orgA, CONFORMANCE_IDS.member, [SYSTEM_ROLES.MEMBER]);
      await ctx.grantRoles(CONFORMANCE_IDS.orgA, CONFORMANCE_IDS.viewer, [SYSTEM_ROLES.VIEWER]);
    });

    it('grants a system role the permissions its definition carries', async () => {
      const decision = await authorization.check(
        userPrincipal(CONFORMANCE_IDS.owner, CONFORMANCE_IDS.orgA),
        PERMISSIONS.ORGANIZATION_DELETE,
      );
      expect(decision.allowed).toBe(true);
    });

    it('denies a permission the role does not carry', async () => {
      const decision = await authorization.check(
        userPrincipal(CONFORMANCE_IDS.viewer, CONFORMANCE_IDS.orgA),
        PERMISSIONS.FILE_DELETE,
      );
      expect(decision.allowed).toBe(false);
    });

    it('denies everything to a principal with no membership', async () => {
      const decision = await authorization.check(
        userPrincipal(CONFORMANCE_IDS.outsider, CONFORMANCE_IDS.orgA),
        PERMISSIONS.ORGANIZATION_READ,
      );
      expect(decision.allowed).toBe(false);
    });

    // A role held in one organization must never carry into another — the failure mode that turns
    // a multi-tenant system into a single-tenant one.
    it('does not carry a role across organizations', async () => {
      const decision = await authorization.check(
        userPrincipal(CONFORMANCE_IDS.owner, CONFORMANCE_IDS.orgB),
        PERMISSIONS.ORGANIZATION_READ,
      );
      expect(decision.allowed).toBe(false);
    });

    it('refuses a resource that belongs to another organization', async () => {
      const decision = await authorization.check(
        userPrincipal(CONFORMANCE_IDS.owner, CONFORMANCE_IDS.orgA),
        PERMISSIONS.FILE_READ,
        {
          type: RESOURCE_TYPES.FILE,
          id: CONFORMANCE_IDS.file,
          organizationId: CONFORMANCE_IDS.orgB,
        },
      );
      expect(decision.allowed).toBe(false);
    });

    it('lets an owner-scoped permission through for the resource the caller owns', async () => {
      const decision = await authorization.check(
        userPrincipal(CONFORMANCE_IDS.viewer, CONFORMANCE_IDS.orgA),
        PERMISSIONS.FILE_DELETE,
        {
          type: RESOURCE_TYPES.FILE,
          id: CONFORMANCE_IDS.file,
          organizationId: CONFORMANCE_IDS.orgA,
          ownerId: CONFORMANCE_IDS.viewer,
        },
      );
      expect(decision.allowed).toBe(true);
    });

    it('resolves a tenant-defined custom role', async () => {
      await ctx.defineCustomRole(CONFORMANCE_IDS.orgA, 'auditor', [PERMISSIONS.AUDIT_LOG_READ]);
      await ctx.grantRoles(CONFORMANCE_IDS.orgA, CONFORMANCE_IDS.member, ['auditor']);

      const decision = await authorization.check(
        userPrincipal(CONFORMANCE_IDS.member, CONFORMANCE_IDS.orgA),
        PERMISSIONS.AUDIT_LOG_READ,
      );
      expect(decision.allowed).toBe(true);
    });

    it('unions permissions when a member holds several roles', async () => {
      await ctx.defineCustomRole(CONFORMANCE_IDS.orgA, 'auditor', [PERMISSIONS.AUDIT_LOG_READ]);
      await ctx.grantRoles(CONFORMANCE_IDS.orgA, CONFORMANCE_IDS.member, [
        SYSTEM_ROLES.MEMBER,
        'auditor',
      ]);

      const decisions = await authorization.checkMany(
        userPrincipal(CONFORMANCE_IDS.member, CONFORMANCE_IDS.orgA),
        [{ permission: PERMISSIONS.AUDIT_LOG_READ }, { permission: PERMISSIONS.FILE_CREATE }],
      );
      expect(decisions.map((d) => d.allowed)).toEqual([true, true]);
    });

    it('answers checkMany in request order', async () => {
      const decisions = await authorization.checkMany(
        userPrincipal(CONFORMANCE_IDS.viewer, CONFORMANCE_IDS.orgA),
        [{ permission: PERMISSIONS.ORGANIZATION_READ }, { permission: PERMISSIONS.FILE_DELETE }],
      );
      expect(decisions.map((d) => d.allowed)).toEqual([true, false]);
    });

    it('produces a filter that scopes a permitted list to the tenant', async () => {
      const filter = await authorization.filter(
        userPrincipal(CONFORMANCE_IDS.member, CONFORMANCE_IDS.orgA),
        PERMISSIONS.FILE_READ,
        RESOURCE_TYPES.FILE,
      );

      const where = applyAccessFilter({ status: 'READY' }, filter);
      expect(where).toMatchObject({ status: 'READY', organizationId: CONFORMANCE_IDS.orgA });
    });

    // `none` must be distinguishable from "no extra condition": collapsing them would turn a
    // forbidden list into a full-table read.
    it('produces a filter that blocks the query entirely when nothing is permitted', async () => {
      const filter = await authorization.filter(
        userPrincipal(CONFORMANCE_IDS.outsider, CONFORMANCE_IDS.orgA),
        PERMISSIONS.AUDIT_LOG_READ,
        RESOURCE_TYPES.AUDIT_LOG,
      );

      expect(applyAccessFilter({ status: 'READY' }, filter)).toBeNull();
    });

    it('narrows the filter to owned rows when only the owner-scoped grant applies', async () => {
      const filter = await authorization.filter(
        userPrincipal(CONFORMANCE_IDS.outsider, CONFORMANCE_IDS.orgA),
        PERMISSIONS.FILE_READ,
        RESOURCE_TYPES.FILE,
      );

      expect(applyAccessFilter({}, filter)).toMatchObject({
        organizationId: CONFORMANCE_IDS.orgA,
        userId: CONFORMANCE_IDS.outsider,
      });
    });

    it('gives the system principal unrestricted access', async () => {
      const principal: Principal = { type: 'system', reason: 'outbox relay' };

      const decision = await authorization.check(principal, PERMISSIONS.AUDIT_LOG_READ);
      const filter = await authorization.filter(
        principal,
        PERMISSIONS.AUDIT_LOG_READ,
        RESOURCE_TYPES.AUDIT_LOG,
      );

      expect(decision.allowed).toBe(true);
      expect(filter).toEqual({ kind: 'all' });
    });

    it('limits an api key to its own scopes', async () => {
      const principal: Principal = {
        type: 'api_key',
        apiKeyId: 'key-1',
        organizationId: CONFORMANCE_IDS.orgA,
        scopes: [PERMISSIONS.FILE_READ],
      };

      const decisions = await authorization.checkMany(principal, [
        { permission: PERMISSIONS.FILE_READ },
        { permission: PERMISSIONS.FILE_DELETE },
      ]);
      expect(decisions.map((d) => d.allowed)).toEqual([true, false]);
    });

    it('accepts the resource lifecycle hooks without requiring a relationship store', async () => {
      const actor = userPrincipal(CONFORMANCE_IDS.owner, CONFORMANCE_IDS.orgA);
      const resource = {
        type: RESOURCE_TYPES.FILE,
        id: CONFORMANCE_IDS.file,
        organizationId: CONFORMANCE_IDS.orgA,
        ownerId: CONFORMANCE_IDS.owner,
      };

      await expect(authorization.onResourceCreated({ actor, resource })).resolves.toBeUndefined();
      await expect(authorization.onResourceDeleted(resource)).resolves.toBeUndefined();
    });

    it('declares capabilities the caller can branch on', () => {
      expect(typeof authorization.capabilities.predicateFilter).toBe('boolean');
      expect(['strong', 'eventual']).toContain(authorization.capabilities.consistency);
    });
  });
}
