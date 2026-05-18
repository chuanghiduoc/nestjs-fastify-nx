import type { Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import type Redis from 'ioredis';

const WS_CONN_KEY_PREFIX = 'ws:conn:';
const WS_CONN_TTL_SECONDS = 600;

/**
 * Socket.io authentication middleware for Better Auth sessions.
 *
 * Browsers cannot read HttpOnly cookies, so a SPA cannot copy
 * `better-auth.session_token` into `socket.handshake.auth.token` — the
 * connection's only credential is the `Cookie` header the browser already
 * sends with the WebSocket upgrade request. We forward that header verbatim
 * to Better Auth's `getSession`.
 *
 * `socket.handshake.auth.token` is still accepted as a fallback for
 * non-browser clients (mobile apps, server-to-server, integration tests)
 * that don't have a cookie jar; it is wrapped into a synthetic cookie
 * header so the same Better Auth code path validates both cases.
 *
 * When `redis` is provided, the middleware additionally enforces a per-IP
 * concurrent-connection cap via an INCR counter. Without it, an attacker can
 * trivially OOM the gateway by opening thousands of authenticated sockets
 * from a single host. Counter is reset on `disconnect` and otherwise
 * expires after 10 minutes — half-open sockets self-clean.
 */
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

      // Defence-in-depth: Better Auth rejects expired sessions, but a race
      // window of a few ms can slip through on cache hits. An explicit check
      // closes that window and makes the failure mode obvious to operators.
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

      // Per-IP connection cap (best-effort; Redis errors fail open so an
      // outage doesn't take down realtime entirely).
      const ip = socket.handshake.address;
      if (redis && ip) {
        try {
          const key = `${WS_CONN_KEY_PREFIX}${ip}`;
          const count = await redis.incr(key);
          if (count === 1) {
            await redis.expire(key, WS_CONN_TTL_SECONDS);
          }
          if (count > maxConcurrentPerIp) {
            await redis.decr(key);
            return next(new Error('TOO_MANY_CONNECTIONS: Per-IP limit exceeded'));
          }
          // Schedule counter decrement on disconnect.
          socket.on('disconnect', () => {
            void redis.decr(key).catch(() => undefined);
          });
        } catch {
          // Fail open on Redis errors. The session is already authenticated
          // and IP rate limiting is a secondary defence.
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
