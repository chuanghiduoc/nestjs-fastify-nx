import type { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { NotificationGateway } from './notification.gateway';

function buildGateway(): NotificationGateway {
  return new NotificationGateway(
    { get: vi.fn() } as unknown as ConfigService<never, true>,
    {} as BetterAuthInstance,
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
