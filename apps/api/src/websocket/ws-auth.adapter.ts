import type { Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import type Redis from 'ioredis';

const WS_CONN_KEY_PREFIX = 'ws:conn:';
const WS_CONN_TTL_MS = 600_000;

const ACQUIRE_CONNECTION_SCRIPT = `
redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1])
redis.call('zadd', KEYS[1], ARGV[1] + ARGV[2], ARGV[3])
redis.call('pexpire', KEYS[1], ARGV[2])
return redis.call('zcard', KEYS[1])`;

const RELEASE_CONNECTION_SCRIPT = `
redis.call('zrem', KEYS[1], ARGV[1])
if redis.call('zcard', KEYS[1]) == 0 then
  redis.call('del', KEYS[1])
end
return 1`;

interface WsConnectionLease {
  key: string;
  member: string;
}

// Browser SPAs forward the Cookie header directly; non-browser clients pass auth.token, which is
// wrapped into a synthetic cookie so both code paths are identical.
// Redis sorted-set leases cap sockets per IP without leaking counts after process crashes.
export interface WsAuthOptions {
  redis?: Redis;
  maxConcurrentPerIp?: number;
  trustProxyHops?: number;
}

export async function revalidateWsSession(auth: BetterAuthInstance, socket: Socket): Promise<void> {
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
    throw new Error('UNAUTHORIZED: No session credentials provided');
  }

  const session = await auth.api.getSession({
    query: { disableCookieCache: true },
    headers: fromNodeHeaders(headers),
  });

  if (!session?.user || !session.session) {
    throw new Error('UNAUTHORIZED: Invalid session');
  }

  const expiresAt = session.session.expiresAt;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    throw new Error('UNAUTHORIZED: Session expired');
  }

  const user = session.user as {
    id: string;
    email: string;
    role: string;
    status: string;
  };
  if (user.status !== 'ACTIVE') {
    throw new Error('UNAUTHORIZED: Account not active');
  }

  socket.data['user'] = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
}

export async function renewWsConnectionLease(redis: Redis, socket: Socket): Promise<void> {
  const lease = socket.data['connectionLease'] as WsConnectionLease | undefined;
  if (!lease) return;
  await redis.eval(
    ACQUIRE_CONNECTION_SCRIPT,
    1,
    lease.key,
    String(Date.now()),
    String(WS_CONN_TTL_MS),
    lease.member,
  );
}

export function createWsAuthMiddleware(auth: BetterAuthInstance, options: WsAuthOptions = {}) {
  const { redis, maxConcurrentPerIp = 50, trustProxyHops = 0 } = options;

  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    try {
      await revalidateWsSession(auth, socket);

      const ip = resolveClientIp(socket, trustProxyHops);
      if (redis && ip) {
        try {
          const key = `${WS_CONN_KEY_PREFIX}${ip}`;
          const count = Number(
            await redis.eval(
              ACQUIRE_CONNECTION_SCRIPT,
              1,
              key,
              String(Date.now()),
              String(WS_CONN_TTL_MS),
              socket.id,
            ),
          );
          if (count > maxConcurrentPerIp) {
            await redis.eval(RELEASE_CONNECTION_SCRIPT, 1, key, socket.id);
            return next(new Error('TOO_MANY_CONNECTIONS: Per-IP limit exceeded'));
          }
          socket.data['connectionLease'] = { key, member: socket.id } satisfies WsConnectionLease;
          socket.on('disconnect', () => {
            void redis.eval(RELEASE_CONNECTION_SCRIPT, 1, key, socket.id).catch(() => undefined);
          });
        } catch {
          // Fail open on Redis errors — session auth already passed; IP cap is secondary defence.
        }
      }

      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error('UNAUTHORIZED: Session validation failed'));
    }
  };
}

// Mirror Fastify's numeric trust-proxy model: walk right-to-left from the TCP peer and skip
// exactly the configured proxy hops. With zero hops, forwarded headers are never trusted.
function resolveClientIp(socket: Socket, trustProxyHops: number): string | undefined {
  const direct = socket.conn.remoteAddress;
  if (!direct || trustProxyHops <= 0) return direct;

  const raw = socket.handshake.headers['x-forwarded-for'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return direct;

  const forwarded = value
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (forwarded.length === 0) return direct;

  const chain = [...forwarded, direct];
  return chain[Math.max(0, chain.length - 1 - trustProxyHops)];
}

function extractBearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) return undefined;
  return value.substring('Bearer '.length);
}
