import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as SocketIoServer, type ServerOptions } from 'socket.io';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationGateway } from './notification.gateway';

describe('WebSocket handshake origin enforcement', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['https://untrusted.example', 400],
    ['https://trusted.example', 101],
    [undefined, 101],
  ])('checks the actual WebSocket upgrade from %s', async (origin, expected) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGINS', 'https://trusted.example');
    const options = Reflect.getMetadata(
      GATEWAY_OPTIONS,
      NotificationGateway,
    ) as Partial<ServerOptions>;
    const http = createServer();
    const io = new SocketIoServer(http, options);
    try {
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({
          hostname: '127.0.0.1',
          port: (http.address() as AddressInfo).port,
          path: '/ws/?EIO=4&transport=websocket',
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.alloc(16, 1).toString('base64'),
            ...(origin ? { Origin: origin } : {}),
          },
        });
        req.on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        req.on('response', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.setTimeout(5_000, () => req.destroy(new Error('Handshake timed out')));
        req.end();
      });
      expect(status).toBe(expected);
    } finally {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });
});
