import { describe, it, expect, vi } from 'vitest';
import { BetterAuthGuard } from './better-auth.guard';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { BetterAuthInstance } from './better-auth.config';

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

describe('BetterAuthGuard', () => {
  it('throws UnauthorizedException when no session', async () => {
    const guard = new BetterAuthGuard(makeAuth(null), makeReflector());
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user is inactive', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', name: 'A', role: 'USER', status: 'INACTIVE' },
      session: { id: 's1', token: 'tok' },
    };
    const guard = new BetterAuthGuard(makeAuth(session), makeReflector());
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
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

    const guard = new BetterAuthGuard(makeAuth(session), makeReflector());
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(request['user']).toMatchObject({ userId: 'u1', email: 'a@b.com', role: 'USER' });
  });
});
