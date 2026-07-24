import type { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import type Redis from 'ioredis';
import { NotificationGateway } from './notification.gateway';

// Narrow, typed view onto the gateway's private surface — avoids `any` while still letting
// tests reach into fields/methods that intentionally have no public accessor.
interface GatewayInternals {
  pubClient?: Redis;
  subClient?: Redis;
  rateLimitClient?: Redis;
  revalidationTimer?: NodeJS.Timeout;
  server: Server;
  revalidateSocket(socket: Socket): Promise<void>;
  revalidateConnectedSockets(): Promise<void>;
}

function internals(gateway: NotificationGateway): GatewayInternals {
  return gateway as unknown as GatewayInternals;
}

function buildGateway(auth?: BetterAuthInstance): NotificationGateway {
  return new NotificationGateway(
    { get: vi.fn() } as unknown as ConfigService<never, true>,
    auth ?? ({} as BetterAuthInstance),
  );
}

function buildSocket(opts?: { userId?: string; joinError?: Error }): Socket {
  return {
    id: 'socket-1',
    data: opts?.userId ? { user: { userId: opts.userId, email: 'user@example.com' } } : {},
    join: vi.fn().mockImplementation(async () => {
      if (opts?.joinError) throw opts.joinError;
    }),
    disconnect: vi.fn(),
  } as unknown as Socket;
}

// Session-revalidation path only touches handshake.auth.token + socket.data — it never goes
// through the connection middleware, so no handshake.headers/conn stub is needed here.
function buildAuthSocket(opts: { token?: string; id?: string } = {}): Socket {
  return {
    id: opts.id ?? 'socket-1',
    handshake: { headers: {}, auth: opts.token ? { token: opts.token } : {} },
    data: {},
    disconnect: vi.fn(),
  } as unknown as Socket;
}

function makeAuth(session: unknown): BetterAuthInstance {
  return {
    api: { getSession: vi.fn().mockResolvedValue(session) },
  } as unknown as BetterAuthInstance;
}

function makeRateLimitClient(): Redis {
  return { eval: vi.fn().mockResolvedValue(1) } as unknown as Redis;
}

const VALID_SESSION = {
  user: { id: 'u1', email: 'a@b.com', role: 'USER', status: 'ACTIVE' },
  session: {
    id: 's1',
    token: 't1',
    userId: 'u1',
    createdAt: new Date(Date.now() - 3_600_000),
    updatedAt: new Date(Date.now() - 3_600_000),
    expiresAt: new Date(Date.now() + 3_600_000),
  },
};

describe('NotificationGateway.handleConnection', () => {
  it('joins the authenticated user room before accepting the connection', async () => {
    const gateway = buildGateway();
    const socket = buildSocket({ userId: 'user-1' });

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('user:user-1');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects when the Redis-backed room join fails', async () => {
    const gateway = buildGateway();
    const socket = buildSocket({ userId: 'user-1', joinError: new Error('redis unavailable') });

    await expect(gateway.handleConnection(socket)).resolves.toBeUndefined();

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects sockets without an authenticated user', async () => {
    const gateway = buildGateway();
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('NotificationGateway.handleDisconnect', () => {
  it('logs the disconnect without throwing for a known user', () => {
    const gateway = buildGateway();
    const socket = buildSocket({ userId: 'user-1' });

    expect(() => gateway.handleDisconnect(socket)).not.toThrow();
  });

  it('logs the disconnect without throwing when the user was never authenticated', () => {
    const gateway = buildGateway();
    const socket = buildSocket();

    expect(() => gateway.handleDisconnect(socket)).not.toThrow();
  });
});

describe('NotificationGateway.sendToUser', () => {
  it('emits the event only to the target users room', () => {
    const gateway = buildGateway();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    internals(gateway).server = { to } as unknown as Server;

    gateway.sendToUser('user-42', 'notification', { message: 'hi' });

    expect(to).toHaveBeenCalledWith('user:user-42');
    expect(emit).toHaveBeenCalledWith('notification', { message: 'hi' });
  });
});

describe('NotificationGateway.broadcast', () => {
  it('emits the event to every connected socket', () => {
    const gateway = buildGateway();
    const emit = vi.fn();
    internals(gateway).server = { emit } as unknown as Server;

    gateway.broadcast('announcement', { message: 'hello' });

    expect(emit).toHaveBeenCalledWith('announcement', { message: 'hello' });
  });
});

describe('NotificationGateway.onApplicationShutdown', () => {
  function makeRedisClient(): Redis {
    return {
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    } as unknown as Redis;
  }

  it('closes all three Redis clients and clears the revalidation timer', async () => {
    const gateway = buildGateway();
    const pubClient = makeRedisClient();
    const subClient = makeRedisClient();
    const rateLimitClient = makeRedisClient();
    const timer = setInterval(() => undefined, 60_000);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    Object.assign(internals(gateway), {
      pubClient,
      subClient,
      rateLimitClient,
      revalidationTimer: timer,
    });

    await gateway.onApplicationShutdown();

    expect(pubClient.quit).toHaveBeenCalledTimes(1);
    expect(subClient.quit).toHaveBeenCalledTimes(1);
    expect(rateLimitClient.quit).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);

    clearIntervalSpy.mockRestore();
  });

  it('falls back to a hard disconnect when a client fails to quit gracefully', async () => {
    const gateway = buildGateway();
    const pubClient = {
      quit: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
      disconnect: vi.fn(),
    } as unknown as Redis;
    const subClient = makeRedisClient();
    const rateLimitClient = makeRedisClient();

    Object.assign(internals(gateway), { pubClient, subClient, rateLimitClient });

    await expect(gateway.onApplicationShutdown()).resolves.toBeUndefined();

    expect(pubClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not throw when afterInit never ran (Redis clients and timer are still undefined)', async () => {
    const gateway = buildGateway();

    await expect(gateway.onApplicationShutdown()).resolves.toBeUndefined();
  });
});

describe('NotificationGateway.revalidateSocket (private, security-critical)', () => {
  it('keeps the socket connected and refreshes user data when the session is still valid', async () => {
    const auth = makeAuth({
      ...VALID_SESSION,
      user: { ...VALID_SESSION.user, role: 'ADMIN' },
    });
    const gateway = buildGateway(auth);
    internals(gateway).rateLimitClient = makeRateLimitClient();
    const socket = buildAuthSocket({ token: 'still-valid' });

    await internals(gateway).revalidateSocket(socket);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect((socket.data as { user?: { role: string } }).user?.role).toBe('ADMIN');
  });

  it('force-disconnects the socket when the session was revoked (deactivated/logged-out user)', async () => {
    const auth = makeAuth(null);
    const gateway = buildGateway(auth);
    internals(gateway).rateLimitClient = makeRateLimitClient();
    const socket = buildAuthSocket({ token: 'revoked' });

    await internals(gateway).revalidateSocket(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('NotificationGateway.revalidateConnectedSockets (private)', () => {
  it('is a no-op when there are no connected sockets', async () => {
    const auth = makeAuth(VALID_SESSION);
    const gateway = buildGateway(auth);
    internals(gateway).server = { sockets: { sockets: new Map() } } as unknown as Server;

    await expect(internals(gateway).revalidateConnectedSockets()).resolves.toBeUndefined();
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it('disconnects only the socket whose session was revoked, leaving valid ones connected', async () => {
    const auth = makeAuth(undefined);
    // The gateway only reads session.user/session fields; a partial mock is sufficient here.
    vi.mocked(auth.api.getSession)
      .mockResolvedValueOnce(
        VALID_SESSION as unknown as Awaited<ReturnType<typeof auth.api.getSession>>,
      )
      .mockResolvedValueOnce(null);
    const gateway = buildGateway(auth);
    internals(gateway).rateLimitClient = makeRateLimitClient();

    const validSocket = buildAuthSocket({ token: 'valid', id: 's1' });
    const revokedSocket = buildAuthSocket({ token: 'revoked', id: 's2' });
    internals(gateway).server = {
      sockets: {
        sockets: new Map([
          ['s1', validSocket],
          ['s2', revokedSocket],
        ]),
      },
    } as unknown as Server;

    await internals(gateway).revalidateConnectedSockets();

    expect(validSocket.disconnect).not.toHaveBeenCalled();
    expect(revokedSocket.disconnect).toHaveBeenCalledWith(true);
  });
});
