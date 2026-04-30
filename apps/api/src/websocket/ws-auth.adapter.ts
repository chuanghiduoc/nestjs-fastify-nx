import type { Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';

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
 */
export function createWsAuthMiddleware(auth: BetterAuthInstance) {
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

      if (!session?.user) {
        return next(new Error('UNAUTHORIZED: Invalid session'));
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
