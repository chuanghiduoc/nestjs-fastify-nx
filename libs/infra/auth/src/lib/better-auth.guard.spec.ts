import { describe, it, expect, vi } from 'vitest';
import * as Sentry from '@sentry/nestjs';
import { BetterAuthGuard } from './better-auth.guard';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import type { BetterAuthInstance } from './better-auth.config';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

vi.mock('@sentry/nestjs', () => ({ setUser: vi.fn() }));

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  const request = { headers, user: undefined };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeAuth(sessionResponse: unknown): BetterAuthInstance {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(sessionResponse),
    },
  } as unknown as BetterAuthInstance;
}

function makeReflector(isPublic = false): Reflector {
  return {
    getAllAndOverride: vi.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
}

function makeCls(active = true): ClsService {
  return {
    isActive: vi.fn().mockReturnValue(active),
    set: vi.fn(),
  } as unknown as ClsService;
}

function makePrisma(options?: { member?: boolean; teamMember?: boolean }): PrismaService {
  return {
    db: {
      member: {
        findUnique: vi
          .fn()
          .mockResolvedValue(options?.member === false ? null : { organizationId: 'org-1' }),
      },
      teamMember: {
        findFirst: vi
          .fn()
          .mockResolvedValue(options?.teamMember === false ? null : { teamId: 'team-1' }),
      },
    },
  } as unknown as PrismaService;
}

describe('BetterAuthGuard', () => {
  it('throws UnauthorizedException when no session', async () => {
    const guard = new BetterAuthGuard(makeAuth(null), makeReflector(), makeCls(), makePrisma());
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException when the session is valid but the account is not active', async () => {
    for (const status of ['INACTIVE', 'BANNED']) {
      const session = {
        user: { id: 'u1', email: 'a@b.com', name: 'A', role: 'USER', status },
        session: { id: 's1', token: 'tok' },
      };
      const guard = new BetterAuthGuard(
        makeAuth(session),
        makeReflector(),
        makeCls(),
        makePrisma(),
      );

      await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(makeContext())).rejects.not.toThrow(UnauthorizedException);
    }
  });

  it('returns true and attaches AuthenticatedSession for valid active session', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'USER', status: 'ACTIVE' },
      session: { id: 's1', token: 'tok123' },
    };
    const request: Record<string, unknown> = { headers: {}, user: undefined };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const guard = new BetterAuthGuard(makeAuth(session), makeReflector(), makeCls(), makePrisma());
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(request['user']).toMatchObject({ userId: 'u1', email: 'a@b.com', role: 'USER' });
  });

  it('bypasses the cookie cache for fresh role and account-status checks', async () => {
    const auth = makeAuth({
      user: { id: 'u1', email: 'a@b.com', name: 'A', role: 'USER', status: 'ACTIVE' },
      session: { id: 's1', token: 'tok' },
    });
    const guard = new BetterAuthGuard(auth, makeReflector(), makeCls(), makePrisma());

    await guard.canActivate(makeContext({ cookie: 'better-auth.session_token=tok' }));

    expect(auth.api.getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    );
  });

  it('seeds the CLS store and Sentry scope with the resolved userId', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'USER', status: 'ACTIVE' },
      session: { id: 's1', token: 'tok123' },
    };
    const cls = makeCls();
    const guard = new BetterAuthGuard(makeAuth(session), makeReflector(), cls, makePrisma());

    await guard.canActivate(makeContext());

    expect(cls.set).toHaveBeenCalledWith('userId', 'u1');
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('skips seeding CLS when no context is active but still sets the Sentry user', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'USER', status: 'ACTIVE' },
      session: { id: 's1', token: 'tok123' },
    };
    const cls = makeCls(false);
    const guard = new BetterAuthGuard(makeAuth(session), makeReflector(), cls, makePrisma());

    await guard.canActivate(makeContext());

    expect(cls.set).not.toHaveBeenCalled();
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('drops a stale organization and team scope after membership removal', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'USER', status: 'ACTIVE' },
      session: {
        id: 's1',
        token: 'tok123',
        activeOrganizationId: 'org-1',
        activeTeamId: 'team-1',
      },
    };
    const request: Record<string, unknown> = { headers: {}, user: undefined };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const cls = makeCls();
    const guard = new BetterAuthGuard(
      makeAuth(session),
      makeReflector(),
      cls,
      makePrisma({ member: false }),
    );

    await guard.canActivate(context);

    expect(request['user']).not.toHaveProperty('organizationId');
    expect(request['user']).not.toHaveProperty('teamId');
    expect(cls.set).not.toHaveBeenCalledWith('organizationId', expect.anything());
  });

  it('keeps only a team scope that belongs to the active organization and user', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', role: 'USER', status: 'ACTIVE' },
      session: {
        id: 's1',
        token: 'tok123',
        activeOrganizationId: 'org-1',
        activeTeamId: 'team-1',
      },
    };
    const request: Record<string, unknown> = { headers: {}, user: undefined };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new BetterAuthGuard(
      makeAuth(session),
      makeReflector(),
      makeCls(),
      makePrisma({ teamMember: false }),
    );

    await guard.canActivate(context);

    expect(request['user']).toMatchObject({ organizationId: 'org-1' });
    expect(request['user']).not.toHaveProperty('teamId');
  });
});
