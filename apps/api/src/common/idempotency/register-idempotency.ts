import { createHash } from 'node:crypto';
import { HttpStatus, type NestInterceptor } from '@nestjs/common';
import { of } from 'rxjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { sanitizeUrlForLogging } from '@nestjs-fastify-nx/shared';
import type { AuthenticatedSession, AuthenticatedApiKey } from '@nestjs-fastify-nx/infra-auth';
import { buildProblemDetails, PROBLEM_CONTENT_TYPE } from '../filters/problem-details.helper';
import { ensureRequestIds } from '../logging/request-id';
import { IdempotencyStore, type AcquireResult } from './idempotency-store';

export interface IdempotencyOptions {
  readonly redis: Redis;
  readonly ttlSeconds: number;
  readonly lockTtlSeconds: number;
  // Reports a Redis failure without throwing — the request continues (fail-open).
  readonly onError?: (message: string) => void;
}

const IDEMPOTENCY_HEADER = 'idempotency-key';
const REPLAYED_HEADER = 'idempotent-replayed';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SCOPED_PATH_PREFIX = '/api/v1/';
const MAX_KEY_LENGTH = 255;

// Exported so TimeoutInterceptor can record a completion the response pipeline missed.
export interface IdempotencyContext {
  storeKey: string;
  fingerprint: string;
  ownerToken: string;
  // Records a 2xx result the onSend hook couldn't — e.g. the handler finished AFTER a 504 timeout
  // already replied, so a retry replays the stored response instead of re-running the mutation.
  // `contentType` preserves replay fidelity for non-JSON responses (@Header('Content-Type', ...));
  // omit it to default to application/json. Best-effort: no-ops if the pending lock already expired.
  completeLate(status: number, value: unknown, contentType?: string): Promise<void>;
}

interface RequestWithIdempotency extends FastifyRequest {
  idempotency?: IdempotencyContext;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

// Only identities stamped by the guards are trusted; raw cookies/headers are not principals.
function extractPrincipal(req: FastifyRequest): string | undefined {
  const authenticated = req as FastifyRequest & {
    user?: AuthenticatedSession;
    apiKey?: AuthenticatedApiKey;
  };
  if (authenticated.apiKey) {
    const { apiKeyId, organizationId } = authenticated.apiKey;
    return JSON.stringify(['api-key', apiKeyId, organizationId]);
  }
  if (authenticated.user) {
    const { sessionId, userId, organizationId } = authenticated.user;
    return JSON.stringify(['session', sessionId, userId, organizationId ?? null]);
  }
  // Public writes have no verified identity and must not share an IP-based response cache.
  return undefined;
}

// Method + full URL (query included) + body. Detects a key reused for a different operation.
function buildFingerprint(req: FastifyRequest): string {
  return sha256(`${req.method}\n${req.url}\n${JSON.stringify(canonicalize(req.body ?? null))}`);
}

function shouldHandle(req: FastifyRequest): boolean {
  return (
    MUTATING_METHODS.has(req.method) &&
    req.url.startsWith(SCOPED_PATH_PREFIX) &&
    typeof req.headers[IDEMPOTENCY_HEADER] === 'string'
  );
}

function sendProblem(
  req: FastifyRequest,
  reply: FastifyReply,
  problem: { status: number; code: string; title: string; detail: string },
): FastifyReply {
  const { status, code, title, detail } = problem;
  // Reuse the id the request already carries (stamped by ClsMiddleware) — minting a second one here
  // would put an X-Request-Id on this 4xx that matches no log line.
  const { requestId } = ensureRequestIds(req.raw, req.headers);
  // Match the shared exception filter's problem response shape.
  return reply
    .status(status)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .header('x-request-id', requestId)
    .send(
      buildProblemDetails({
        status,
        title,
        detail,
        code,
        instance: sanitizeUrlForLogging(req.url),
        requestId,
      }),
    );
}

// Adds the idempotency hooks directly to the root Fastify instance (NOT via register(), whose
// encapsulation would scope the hooks away from Nest's root-registered routes). Register this
// BEFORE @fastify/compress so the onSend hook stores the uncompressed JSON body.
// Install the returned interceptor globally on Nest; it owns acquisition/replay after guards.
export function registerIdempotency(
  fastify: FastifyInstance,
  options: IdempotencyOptions,
): NestInterceptor {
  const store = new IdempotencyStore(options.redis, options.lockTtlSeconds, options.ttlSeconds);
  const reportError = options.onError ?? ((): void => undefined);

  const acquire = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!shouldHandle(req)) return;
    const principal = extractPrincipal(req);
    if (!principal) return;

    const key = req.headers[IDEMPOTENCY_HEADER] as string;
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      await sendProblem(req, reply, {
        status: HttpStatus.BAD_REQUEST,
        code: ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
        title: 'Invalid Idempotency-Key',
        detail: `Idempotency-Key must be between 1 and ${MAX_KEY_LENGTH} characters.`,
      });
      return;
    }

    const storeKey = `idem:${sha256(JSON.stringify([principal, key]))}`;
    const fingerprint = buildFingerprint(req);

    let result: AcquireResult;
    try {
      result = await store.acquire(storeKey, fingerprint);
    } catch (err) {
      // Fail-open: a Redis outage must not take down writes. Duplicate protection lapses for the
      // outage window only — mirrors the throttler's fail-open posture.
      reportError(`idempotency acquire failed: ${(err as Error).message}`);
      return;
    }

    if (result.acquired) {
      const ownerToken = result.ownerToken;
      (req as RequestWithIdempotency).idempotency = {
        storeKey,
        fingerprint,
        ownerToken,
        completeLate: async (status, value, contentType) => {
          if (status < 200 || status >= 300) return;
          // Same capture contract as the onSend hook (replayableBody): undefined => non-capturable
          // (Buffer/stream) — leave the record pending until TTL rather than store a wrong body.
          const body = serializeReplayBody(value);
          if (body === undefined) return;
          try {
            await store.complete(storeKey, ownerToken, {
              fingerprint,
              status,
              contentType: contentType ?? 'application/json',
              body,
            });
          } catch (err) {
            try {
              reportError(`idempotency late-complete failed: ${(err as Error).message}`);
            } catch {
              // Never let the error reporter's own failure escape completeLate (interceptor voids it).
            }
          }
        },
      };
      return;
    }

    const record = result.record;
    if (record.state === 'pending') {
      await sendProblem(req, reply, {
        status: HttpStatus.CONFLICT,
        code: ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
        title: 'Idempotency-Key In Progress',
        detail: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
      });
      return;
    }

    if (record.fingerprint !== fingerprint) {
      await sendProblem(req, reply, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ERROR_CODES.IDEMPOTENCY_KEY_MISMATCH,
        title: 'Idempotency-Key Reused',
        detail: 'This Idempotency-Key was already used with a different request payload.',
      });
      return;
    }

    // Replay only after all Nest guards have accepted this request.
    const { requestId, correlationId } = ensureRequestIds(req.raw, req.headers);
    await reply
      .status(record.status ?? 200)
      .header('content-type', record.contentType ?? 'application/json')
      .header(REPLAYED_HEADER, 'true')
      .header('x-request-id', requestId)
      .header('x-correlation-id', correlationId)
      .send(record.body);
  };

  fastify.addHook('onSend', async (req, reply, payload) => {
    const ctx = (req as RequestWithIdempotency).idempotency;
    if (!ctx) return payload;

    try {
      await finalizeIdempotentResponse(store, ctx, reply, payload, reportError);
    } catch (err) {
      reportError(`idempotency finalize failed: ${(err as Error).message}`);
    }

    return payload;
  });

  return {
    async intercept(context, next) {
      if (context.getType() !== 'http') return next.handle();
      const http = context.switchToHttp();
      const reply = http.getResponse<FastifyReply>();
      await acquire(http.getRequest<FastifyRequest>(), reply);
      return reply.sent ? of(undefined) : next.handle();
    },
  };
}

async function finalizeIdempotentResponse(
  store: IdempotencyStore,
  ctx: IdempotencyContext,
  reply: FastifyReply,
  payload: unknown,
  reportError: (message: string) => void,
): Promise<void> {
  const status = reply.statusCode;
  const isSuccess = status >= 200 && status < 300;
  if (isSuccess) {
    await completeSuccessRecord(store, ctx, reply, payload, status, reportError);
    return;
  }
  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return;
  }
  await store.release(ctx.storeKey, ctx.ownerToken);
}

async function completeSuccessRecord(
  store: IdempotencyStore,
  ctx: IdempotencyContext,
  reply: FastifyReply,
  payload: unknown,
  status: number,
  reportError: (message: string) => void,
): Promise<void> {
  const body = replayableBody(payload);
  if (body === undefined) {
    // Streams/Buffers can't be captured for byte-exact replay without consuming them. Leave
    // the record pending so a duplicate gets 409 rather than re-executing the mutation.
    reportError(
      `idempotency cannot replay a non-text ${status} body; leaving key pending until TTL`,
    );
    return;
  }
  const completed = await store.complete(ctx.storeKey, ctx.ownerToken, {
    fingerprint: ctx.fingerprint,
    status,
    contentType: String(reply.getHeader('content-type') ?? 'application/json'),
    body,
  });
  if (!completed) {
    reportError('idempotency completion skipped because request no longer owns the lock');
  }
}

// An empty body (204 and friends) replays as an empty string. Anything not already text is not
// safely capturable here — signalled with undefined so the caller can keep the key pending.
function replayableBody(payload: unknown): string | undefined {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  return undefined;
}

// Late-completion (TimeoutInterceptor) captures the handler's RETURN value, not the already-serialized
// payload replayableBody sees — so it also JSON-encodes objects. Mirrors replayableBody's contract:
// empty/absent => '', Buffer/stream => undefined (non-capturable, leave pending), else JSON.
export function serializeReplayBody(value: unknown): string | undefined {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value) || typeof (value as { pipe?: unknown }).pipe === 'function') {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
