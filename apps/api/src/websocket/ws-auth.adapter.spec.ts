import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import type Redis from 'ioredis';
import {
  createWsAuthMiddleware,
  renewWsConnectionLease,
  revalidateWsSession,
} from './ws-auth.adapter';

function makeSocket(
  overrides: {
    auth?: Record<string, string>;
    headers?: Record<string, string>;
    data?: Record<string, unknown>;
    connRemoteAddress?: string;
    handshakeAddress?: string;
  } = {},
) {
  return {
    id: 'socket-1',
    handshake: {
      auth: overrides.auth ?? {},
      headers: overrides.headers ?? {},
      // handshake.address is intentionally NOT set as a default — tests that
      // need it pass it explicitly to confirm it is never consulted.
      ...(overrides.handshakeAddress !== undefined ? { address: overrides.handshakeAddress } : {}),
    },
    // conn.remoteAddress is the raw TCP peer — always present in a real socket.
    conn: { remoteAddress: overrides.connRemoteAddress ?? '127.0.0.1' },
    data: overrides.data ?? {},
    on: vi.fn(),
  };
}

function makeAuth(session: unknown) {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(session),
    },
  } as unknown as BetterAuthInstance;
}

function makeRedis(incrResult = 1): Redis {
  return {
    eval: vi.fn().mockResolvedValue(incrResult),
  } as unknown as Redis;
}

const VALID_SESSION = {
  user: { id: 'u1', email: 'a@b.com', role: 'USER', status: 'ACTIVE' },
  session: {
    id: 's1',
    token: 't1',
    expiresAt: new Date(Date.now() + 3_600_000),
  },
};

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
    // Better Auth's getSession returns `{ user, session }` — fixtures must
    // include both keys so the middleware's structural checks engage.
    const session = {
      user: { id: 'u1', email: 'a@b.com', role: 'USER', status: 'INACTIVE' },
      session: {
        id: 's1',
        token: 't1',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
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
    const auth = makeAuth(VALID_SESSION);
    const middleware = createWsAuthMiddleware(auth);
    const socket = makeSocket({ auth: { token: 'valid-token' } });
    const next = vi.fn();

    await middleware(socket as unknown as Socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data['user']).toMatchObject({ userId: 'u1', email: 'a@b.com' });
    expect(auth.api.getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    );
  });

  it('rejects an expired session even when user is otherwise valid', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.com', role: 'USER', status: 'ACTIVE' },
      session: {
        id: 's1',
        token: 't1',
        expiresAt: new Date(Date.now() - 1_000),
      },
    };
    const auth = makeAuth(session);
    const middleware = createWsAuthMiddleware(auth);
    const socket = makeSocket({ auth: { token: 'expired-token' } });
    const next = vi.fn();

    await middleware(socket as unknown as Socket, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('expired') }),
    );
  });

  describe('per-IP connection cap', () => {
    it('uses conn.remoteAddress for the Redis key, not handshake.address', async () => {
      const auth = makeAuth(VALID_SESSION);
      const redis = makeRedis(1);
      const middleware = createWsAuthMiddleware(auth, { redis, maxConcurrentPerIp: 50 });

      // Provide a spoofed handshake.address distinct from the real TCP peer.
      // The Redis key must be keyed on conn.remoteAddress (the TCP peer).
      const socket = makeSocket({
        auth: { token: 'tok' },
        connRemoteAddress: '10.0.0.1',
        handshakeAddress: '1.2.3.4', // attacker-controlled via XFF
      });
      const next = vi.fn();

      await middleware(socket as unknown as Socket, next);

      expect(next).toHaveBeenCalledWith();
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.stringContaining('10.0.0.1'),
        expect.any(String),
        '600000',
        'socket-1',
      );
      expect(redis.eval).not.toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.stringContaining('1.2.3.4'),
        expect.anything(),
      );
    });

    it('uses the first untrusted address behind the configured proxy hops', async () => {
      const auth = makeAuth(VALID_SESSION);
      const redis = makeRedis(1);
      const middleware = createWsAuthMiddleware(auth, {
        redis,
        maxConcurrentPerIp: 50,
        trustProxyHops: 2,
      });
      const socket = makeSocket({
        auth: { token: 'tok' },
        connRemoteAddress: '10.0.0.10',
        headers: { 'x-forwarded-for': '203.0.113.20, 10.0.0.5' },
      });

      await middleware(socket as unknown as Socket, vi.fn());

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.stringContaining('203.0.113.20'),
        expect.any(String),
        '600000',
        'socket-1',
      );
    });

    it('rejects the connection when the per-IP cap is exceeded', async () => {
      const auth = makeAuth(VALID_SESSION);
      // incr returns 51 — one over the default cap of 50.
      const redis = makeRedis(51);
      const middleware = createWsAuthMiddleware(auth, { redis, maxConcurrentPerIp: 50 });
      const socket = makeSocket({ auth: { token: 'tok' }, connRemoteAddress: '10.0.0.2' });
      const next = vi.fn();

      await middleware(socket as unknown as Socket, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('TOO_MANY_CONNECTIONS') }),
      );
      expect(redis.eval).toHaveBeenCalledTimes(2);
    });

    it('uses an atomic release handler on disconnect', async () => {
      const auth = makeAuth(VALID_SESSION);
      const redis = makeRedis(1);
      const middleware = createWsAuthMiddleware(auth, { redis, maxConcurrentPerIp: 50 });
      const socket = makeSocket({ auth: { token: 'tok' }, connRemoteAddress: '10.0.0.3' });

      await middleware(socket as unknown as Socket, vi.fn());
      const disconnectHandler = vi
        .mocked(socket.on)
        .mock.calls.find(([event]) => event === 'disconnect')?.[1] as (() => void) | undefined;
      expect(disconnectHandler).toBeDefined();
      disconnectHandler?.();
      await vi.waitFor(() => expect(redis.eval).toHaveBeenCalledTimes(2));
    });

    it('renews the exact socket lease during session revalidation', async () => {
      const auth = makeAuth(VALID_SESSION);
      const redis = makeRedis(1);
      const socket = makeSocket({ auth: { token: 'tok' }, connRemoteAddress: '10.0.0.4' });
      await createWsAuthMiddleware(auth, { redis })(socket as unknown as Socket, vi.fn());
      vi.mocked(redis.eval).mockClear();

      await renewWsConnectionLease(redis, socket as unknown as Socket);

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ws:conn:10.0.0.4',
        expect.any(String),
        '600000',
        'socket-1',
      );
    });
  });
});

describe('revalidateWsSession', () => {
  it('refreshes role changes on an already-connected socket', async () => {
    const auth = makeAuth({
      ...VALID_SESSION,
      user: { ...VALID_SESSION.user, role: 'ADMIN' },
    });
    const socket = makeSocket({
      auth: { token: 'valid-token' },
      data: { user: { userId: 'u1', email: 'a@b.com', role: 'USER' } },
    });

    await revalidateWsSession(auth, socket as unknown as Socket);

    expect(socket.data['user']).toMatchObject({ userId: 'u1', role: 'ADMIN' });
  });

  it('rejects a socket after its session is revoked', async () => {
    const socket = makeSocket({ auth: { token: 'revoked-token' } });

    await expect(revalidateWsSession(makeAuth(null), socket as unknown as Socket)).rejects.toThrow(
      'Invalid session',
    );
  });
});
