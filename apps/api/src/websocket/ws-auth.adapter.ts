import type { IncomingMessage } from 'node:http';
import type { Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import proxyaddr from 'proxy-addr';
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

// socket.io types `socket.data` as `any`; this is the shape this app stores on it.
export interface WsSocketData {
  user?: { userId: string; email: string; role: string };
  connectionLease?: WsConnectionLease;
}

export function wsData(socket: Socket): WsSocketData {
  return socket.data as WsSocketData;
}

// Browser SPAs forward the Cookie header directly; non-browser clients pass auth.token, forwarded
// as an Authorization: Bearer header for the Better Auth bearer plugin to validate.
// Redis sorted-set leases cap sockets per IP without leaking counts after process crashes.
export interface WsAuthOptions {
  redis?: Redis;
  maxConcurrentPerIp?: number;
  trustProxyHops?: number;
}

export async function revalidateWsSession(auth: BetterAuthInstance, socket: Socket): Promise<void> {
  const cookieHeader = socket.handshake.headers['cookie'];
  const bearerToken =
    (socket.handshake.auth['token'] as string | undefined) ||
    extractBearer(socket.handshake.headers['authorization']);

  const headers: Record<string, string> = {};
  if (cookieHeader) headers['cookie'] = cookieHeader;
  // Non-browser clients pass the session token via auth.token / Authorization. Hand it to the
  // bearer plugin as-is — it verifies the signature and maps it to the correctly-named session
  // cookie (incl. __Secure- under useSecureCookies), which a synthetic cookie can't do reliably.
  if (bearerToken) headers['authorization'] = `Bearer ${bearerToken}`;

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

  wsData(socket).user = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
}

export async function renewWsConnectionLease(redis: Redis, socket: Socket): Promise<void> {
  const lease = wsData(socket).connectionLease;
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

// Frees the per-IP concurrency lease for a socket. Used both on normal disconnect and on graceful
// shutdown — otherwise a rolling deploy leaves leases dangling until WS_CONN_TTL_MS, wrongly rejecting
// NAT'd users who reconnect to the new pod.
export async function releaseWsConnectionLease(redis: Redis, socket: Socket): Promise<void> {
  const lease = wsData(socket).connectionLease;
  if (!lease) return;
  await redis.eval(RELEASE_CONNECTION_SCRIPT, 1, lease.key, lease.member);
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
          wsData(socket).connectionLease = { key, member: socket.id };
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

// Mirror Fastify's numeric trust-proxy model via `proxy-addr` (the same package Fastify uses
// internally): trust exactly the configured number of hops walking in from the TCP peer, then
// return the first untrusted (i.e. client) address. With zero hops, forwarded headers are never
// trusted — proxy-addr's trust callback receives a hop index, not a raw count, so it cannot accept
// a bare number the way Fastify's `trustProxy` option does; the index-based predicate below
// reproduces that same "trust N hops" semantics.
function resolveClientIp(socket: Socket, trustProxyHops: number): string | undefined {
  const direct = socket.conn.remoteAddress;
  if (!direct || trustProxyHops <= 0) return direct;

  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  const reqLike = {
    headers: {
      ...socket.handshake.headers,
      // Node joins duplicate x-forwarded-for headers into one comma string; the array branch is
      // defensive — join it (not [0]) so every hop is preserved for proxy-addr to parse.
      'x-forwarded-for': Array.isArray(forwardedFor) ? forwardedFor.join(', ') : forwardedFor,
    },
    socket: { remoteAddress: direct },
    connection: { remoteAddress: direct },
  } as unknown as IncomingMessage;

  return proxyaddr(reqLike, (_addr, hopIndex) => hopIndex < trustProxyHops);
}

function extractBearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) return undefined;
  return value.substring('Bearer '.length);
}
