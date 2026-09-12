import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as SocketIoServer, type ServerOptions } from 'socket.io';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationGateway } from './notification.gateway';

describe('WebSocket handshake origin enforcement', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['production', 'https://trusted.example', 'https://untrusted.example', 400],
    ['production', 'https://trusted.example', 'https://trusted.example', 101],
    ['production', 'https://trusted.example', undefined, 101],
    ['production', '', 'http://localhost:5173', 400],
    ['development', '', 'https://untrusted.example', 400],
    ['development', '', 'http://localhost:5173', 101],
    ['development', '', 'http://127.0.0.1:4200', 101],
    ['development', '', undefined, 101],
    ['development', 'https://trusted.example', 'http://localhost:5173', 400],
    ['development', ' https://trusted.example , ', 'https://trusted.example', 101],
  ])('checks %s upgrade with allowlist %s from %s', async (mode, origins, origin, expected) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('CORS_ORIGINS', origins);
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
