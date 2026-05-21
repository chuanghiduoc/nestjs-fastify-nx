import type { Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import type Redis from 'ioredis';

const WS_CONN_KEY_PREFIX = 'ws:conn:';
const WS_CONN_TTL_SECONDS = 600;

// Browser SPAs forward the Cookie header directly; non-browser clients pass auth.token, which is
// wrapped into a synthetic cookie so both code paths are identical.
// Redis INCR cap prevents OOM from thousands of sockets per IP.
export interface WsAuthOptions {
  redis?: Redis;
  maxConcurrentPerIp?: number;
}

export function createWsAuthMiddleware(auth: BetterAuthInstance, options: WsAuthOptions = {}) {
  const { redis, maxConcurrentPerIp = 50 } = options;

  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    try {
      const cookieHeader = socket.handshake.headers['cookie'];
      const fallbackToken =
        (socket.handshake.auth['token'] as string | undefined) ||
        extractBearer(socket.handshake.headers['authorization']);

      const headers: Record<string, string> = cookieHeader
        ? { cookie: cookieHeader }
        : fallbackToken
          ? { cookie: `better-auth.session_token=${fallbackToken}` }
          : {};

      if (Object.keys(headers).length === 0) {
        return next(new Error('UNAUTHORIZED: No session credentials provided'));
      }

      const session = await auth.api.getSession({
        headers: fromNodeHeaders(headers),
      });

      if (!session?.user || !session.session) {
        return next(new Error('UNAUTHORIZED: Invalid session'));
      }

      // Explicit expiry check closes the cache-hit race window where getSession() returns stale data.
      const expiresAt = session.session.expiresAt;
      const expired = expiresAt && new Date(expiresAt).getTime() < Date.now();
      if (expired) {
        return next(new Error('UNAUTHORIZED: Session expired'));
      }

      const user = session.user as {
        id: string;
        email: string;
        role: string;
        status: string;
      };

      if (user.status !== 'ACTIVE') {
        return next(new Error('UNAUTHORIZED: Account not active'));
      }

      // socket.conn.remoteAddress is raw TCP; handshake.address is XFF-spoofable.
      const ip = socket.conn.remoteAddress;
      if (redis && ip) {
        try {
          const key = `${WS_CONN_KEY_PREFIX}${ip}`;
          // Unconditional EXPIRE after INCR: a crash between the two would leave the key TTL-less.
          const count = await redis.incr(key);
          await redis.expire(key, WS_CONN_TTL_SECONDS);
          if (count > maxConcurrentPerIp) {
            await redis.decr(key);
            return next(new Error('TOO_MANY_CONNECTIONS: Per-IP limit exceeded'));
          }
          socket.on('disconnect', () => {
            void redis.decr(key).catch(() => undefined);
          });
        } catch {
          // Fail open on Redis errors — session auth already passed; IP cap is secondary defence.
        }
      }

      socket.data['user'] = {
        userId: user.id,
        email: user.email,
        role: user.role,
      };

      next();
    } catch {
      next(new Error('UNAUTHORIZED: Session validation failed'));
    }
  };
}

function extractBearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) return undefined;
  return value.substring('Bearer '.length);
}
