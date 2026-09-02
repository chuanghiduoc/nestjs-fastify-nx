import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { isDomainException, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { PermissionGuard } from './permission.guard';
import { InMemoryAuthorizationAdapter } from './in-memory-authorization.adapter';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90200001';
const USER_ID = '019dd1a5-9235-70db-8d57-54ef90200002';

function session(overrides: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
  return {
    userId: USER_ID,
    email: 'a@example.com',
    name: 'A',
    role: 'USER',
    status: 'ACTIVE',
    sessionId: 's-1',
    sessionToken: 't-1',
    organizationId: ORG_ID,
    ...overrides,
  };
}

function contextFor(
  user: AuthenticatedSession | undefined,
  type: 'http' | 'ws' = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function reflectorFor(values: { isPublic?: boolean; permissions?: string[] }): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) =>
      key === 'required_permissions' ? values.permissions : values.isPublic,
    ),
  } as unknown as Reflector;
}

describe('PermissionGuard', () => {
  let authorization: InMemoryAuthorizationAdapter;

  beforeEach(() => {
    authorization = new InMemoryAuthorizationAdapter();
    authorization.setMemberRoles(ORG_ID, USER_ID, ['member']);
  });

  function build(values: { isPublic?: boolean; permissions?: string[] }): PermissionGuard {
    return new PermissionGuard(reflectorFor(values), authorization as unknown as AuthorizationPort);
  }

  it('allows a handler that declares no permission', async () => {
    const guard = build({});
    await expect(guard.canActivate(contextFor(session()))).resolves.toBe(true);
  });

  it('allows a public handler without consulting the engine', async () => {
    const spy = vi.spyOn(authorization, 'checkMany');
    const guard = build({ isPublic: true, permissions: [PERMISSIONS.ORGANIZATION_DELETE] });

    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  // WebSocket frames are authorized at the socket.io layer; running here would read the socket as
  // an HTTP request, which is the failure the global-enhancer rule in CLAUDE.md exists to prevent.
  it('never runs on the ws context', async () => {
    const spy = vi.spyOn(authorization, 'checkMany');
    const guard = build({ permissions: [PERMISSIONS.ORGANIZATION_DELETE] });

    await expect(guard.canActivate(contextFor(undefined, 'ws'))).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('permits a caller whose role carries the permission', async () => {
    const guard = build({ permissions: [PERMISSIONS.FILE_CREATE] });
    await expect(guard.canActivate(contextFor(session()))).resolves.toBe(true);
  });

  it('refuses a caller whose role does not carry the permission', async () => {
    const guard = build({ permissions: [PERMISSIONS.ORGANIZATION_DELETE] });

    await expect(guard.canActivate(contextFor(session()))).rejects.toSatisfy(
      (err: unknown) => isDomainException(err) && err.kind === 'forbidden',
    );
  });

  it('requires every declared permission, not just one', async () => {
    const guard = build({
      permissions: [PERMISSIONS.FILE_CREATE, PERMISSIONS.ORGANIZATION_DELETE],
    });

    await expect(guard.canActivate(contextFor(session()))).rejects.toSatisfy(
      (err: unknown) => isDomainException(err) && err.kind === 'forbidden',
    );
  });

  it('reports a missing organization as its own failure, not as a denied permission', async () => {
    const guard = build({ permissions: [PERMISSIONS.FILE_CREATE] });

    await expect(
      guard.canActivate(contextFor(session({ organizationId: undefined }))),
    ).rejects.toSatisfy(
      (err: unknown) => isDomainException(err) && err.code === 'organization_context_required',
    );
  });

  describe('caller without an active organization', () => {
    it('may still manage their own sessions and read global terms', async () => {
      const spy = vi.spyOn(authorization, 'checkMany');
      const guard = build({ permissions: [PERMISSIONS.SESSION_READ, PERMISSIONS.TERM_READ] });

      await expect(
        guard.canActivate(contextFor(session({ organizationId: undefined }))),
      ).resolves.toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it('is refused a global permission that is not self-service', async () => {
      const guard = build({ permissions: [PERMISSIONS.TERM_MANAGE] });

      await expect(
        guard.canActivate(contextFor(session({ organizationId: undefined }))),
      ).rejects.toSatisfy((err: unknown) => isDomainException(err) && err.kind === 'forbidden');
    });

    it('still needs an organization when any declared permission is tenant-bound', async () => {
      const guard = build({ permissions: [PERMISSIONS.SESSION_READ, PERMISSIONS.FILE_CREATE] });

      await expect(
        guard.canActivate(contextFor(session({ organizationId: undefined }))),
      ).rejects.toSatisfy(
        (err: unknown) => isDomainException(err) && err.code === 'organization_context_required',
      );
    });
  });

  describe('caller removed from their active organization', () => {
    beforeEach(() => authorization.reset());

    it('may still revoke their own sessions', async () => {
      const guard = build({ permissions: [PERMISSIONS.SESSION_REVOKE] });
      await expect(guard.canActivate(contextFor(session()))).resolves.toBe(true);
    });

    it('is still refused tenant-bound permissions', async () => {
      const guard = build({ permissions: [PERMISSIONS.FILE_READ] });
      await expect(guard.canActivate(contextFor(session()))).rejects.toSatisfy(
        (err: unknown) => isDomainException(err) && err.kind === 'forbidden',
      );
    });
  });
});
