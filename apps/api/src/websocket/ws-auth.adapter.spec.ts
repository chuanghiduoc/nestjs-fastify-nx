import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { createWsAuthMiddleware } from './ws-auth.adapter';

function makeSocket(
  overrides: {
    auth?: Record<string, string>;
    headers?: Record<string, string>;
    data?: Record<string, unknown>;
  } = {},
) {
  return {
    handshake: {
      auth: overrides.auth ?? {},
      headers: overrides.headers ?? {},
    },
    data: overrides.data ?? {},
  };
}

function makeAuth(session: unknown) {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(session),
    },
  } as unknown as BetterAuthInstance;
}

describe('createWsAuthMiddleware', () => {
  it('calls next with error when no token provided', async () => {
    const auth = makeAuth(null);
    const middleware = createWsAuthMiddleware(auth);
    const socket = makeSocket();
    const next = vi.fn();

    await middleware(socket as unknown as Socket, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('No session credentials') }),
    );
  });

  it('calls next with error when session is invalid', async () => {
    const auth = makeAuth(null);
    const middleware = createWsAuthMiddleware(auth);
    const socket = makeSocket({ auth: { token: 'invalid-token' } });
    const next = vi.fn();

    await middleware(socket as unknown as Socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('calls next with error when user is inactive', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', role: 'USER', status: 'INACTIVE' },
    };
    const auth = makeAuth(session);
    const middleware = createWsAuthMiddleware(auth);
    const socket = makeSocket({ auth: { token: 'some-token' } });
    const next = vi.fn();

    await middleware(socket as unknown as Socket, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('not active') }),
    );
  });

  it('attaches user data and calls next() without error for valid session', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', role: 'USER', status: 'ACTIVE' },
    };
    const auth = makeAuth(session);
    const middleware = createWsAuthMiddleware(auth);
    const socket = makeSocket({ auth: { token: 'valid-token' } });
    const next = vi.fn();

    await middleware(socket as unknown as Socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data['user']).toMatchObject({ userId: 'u1', email: 'a@b.com' });
  });
});
