import type { FastifyRequest } from 'fastify';
import type { RequestContext } from '../../application/types/request-context.type';

const USER_AGENT_MAX_LENGTH = 512;

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.length > USER_AGENT_MAX_LENGTH ? value.slice(0, USER_AGENT_MAX_LENGTH) : value;
}

/**
 * Builds a transport-agnostic RequestContext from a Fastify request.
 *
 * `request.ip` already honours the `trustProxy` setting configured in
 * `main.ts`, so it returns the originating client when running behind a
 * trusted reverse proxy and falls back to the socket peer otherwise.
 */
export function extractRequestContext(request: FastifyRequest): RequestContext {
  const userAgentHeader = request.headers['user-agent'];
  const headerValue = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;

  return {
    ip: asString(request.ip),
    userAgent: asString(headerValue),
  };
}
