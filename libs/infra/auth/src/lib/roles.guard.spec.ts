import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard';

function context(role: string | undefined): ExecutionContext {
  return {
    getType: () => 'ws',
    getHandler: () =>
      function handler() {
        return undefined;
      },
    getClass: () => class Gateway {},
    switchToWs: () => ({
      getClient: () => ({ data: role ? { user: { role } } : {} }),
      getData: vi.fn(),
      getPattern: vi.fn(),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard WebSocket enforcement', () => {
  function guard(requiredRoles: string[]): RolesGuard {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows a socket with a required role', () => {
    expect(guard(['admin']).canActivate(context('admin'))).toBe(true);
  });

  it('rejects missing or insufficient WebSocket roles', () => {
    expect(() => guard(['admin']).canActivate(context('user'))).toThrow(ForbiddenException);
    expect(() => guard(['admin']).canActivate(context(undefined))).toThrow(ForbiddenException);
  });
});
