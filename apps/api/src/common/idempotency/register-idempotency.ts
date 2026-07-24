import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { parse as parseCookie } from 'cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { buildProblemDetails, PROBLEM_CONTENT_TYPE } from '../filters/problem-details.helper';
import { resolveCorrelationId, resolveRequestId } from '../logging/request-id';
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
  // Best-effort: if the pending lock already expired (handler slower than the lock TTL) it no-ops.
  completeLate(status: number, value: unknown): Promise<void>;
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

// Authenticated requests scope by session token, anonymous ones by client IP. Two principals thus
// never collide on — nor replay — each other's cached response for the same key.
function extractPrincipal(req: FastifyRequest): string {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string') {
    const parsed = parseCookie(cookieHeader);
    // Better Auth uses the `__Secure-` cookie in production (HTTPS) and the bare name in dev. Prefer
    // `__Secure-`, and use `||` (not `??`) so an empty leftover cookie value (`...session_token=`)
    // does NOT shadow a real token and silently drop the request to IP scope — which would let two
    // users behind the same NAT collide on idempotency records.
    const token =
      parsed['__Secure-better-auth.session_token'] || parsed['better-auth.session_token'];
    if (token) return `s:${token}`;
  }
  return `ip:${req.ip}`;
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
  status: number,
  code: string,
  title: string,
  detail: string,
): FastifyReply {
  const requestId = resolveRequestId(req.headers);
  (req.raw as { requestId?: string }).requestId = requestId;
  // Same builder the global filter uses — this plugin runs before the Nest pipeline, so nothing
  // else would give it the shared shape.
  return reply
    .status(status)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .header('x-request-id', requestId)
    .send(buildProblemDetails({ status, title, detail, code, instance: req.url, requestId }));
}

// Adds the idempotency hooks directly to the root Fastify instance (NOT via register(), whose
// encapsulation would scope the hooks away from Nest's root-registered routes). Register this
// BEFORE @fastify/compress so the onSend hook stores the uncompressed JSON body.
export function registerIdempotency(fastify: FastifyInstance, options: IdempotencyOptions): void {
  const store = new IdempotencyStore(options.redis, options.lockTtlSeconds, options.ttlSeconds);
  const reportError = options.onError ?? ((): void => undefined);

  fastify.addHook('preHandler', async (req, reply) => {
    if (!shouldHandle(req)) return;

    const key = req.headers[IDEMPOTENCY_HEADER] as string;
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      return sendProblem(
        req,
        reply,
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
        'Invalid Idempotency-Key',
        `Idempotency-Key must be between 1 and ${MAX_KEY_LENGTH} characters.`,
      );
    }

    const storeKey = `idem:${sha256(`${extractPrincipal(req)}:${key}`)}`;
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
        completeLate: async (status, value) => {
          if (status < 200 || status >= 300) return;
          // Same capture contract as the onSend hook (replayableBody): undefined => non-capturable
          // (Buffer/stream) — leave the record pending until TTL rather than store a wrong body.
          const body = serializeReplayBody(value);
          if (body === undefined) return;
          try {
            await store.complete(storeKey, ownerToken, {
              fingerprint,
              status,
              contentType: 'application/json',
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
      return sendProblem(
        req,
        reply,
        HttpStatus.CONFLICT,
        ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
        'Idempotency-Key In Progress',
        'A request with this Idempotency-Key is still being processed. Retry shortly.',
      );
    }

    if (record.fingerprint !== fingerprint) {
      return sendProblem(
        req,
        reply,
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.IDEMPOTENCY_KEY_MISMATCH,
        'Idempotency-Key Reused',
        'This Idempotency-Key was already used with a different request payload.',
      );
    }

    // Replay the stored response verbatim. This short-circuits before Nest, so x-request-id
    // (normally set by CorrelationIdMiddleware) must be stamped here.
    const requestId = resolveRequestId(req.headers);
    const correlationId = resolveCorrelationId(req.headers, requestId);
    Object.assign(req.raw, { requestId, correlationId });
    return reply
      .status(record.status ?? 200)
      .header('content-type', record.contentType ?? 'application/json')
      .header(REPLAYED_HEADER, 'true')
      .header('x-request-id', requestId)
      .header('x-correlation-id', correlationId)
      .send(record.body);
  });

  fastify.addHook('onSend', async (req, reply, payload) => {
    const ctx = (req as RequestWithIdempotency).idempotency;
    if (!ctx) return payload;

    try {
      const status = reply.statusCode;
      const isSuccess = status >= 200 && status < 300;
      // Branch on status first: a 2xx is a completed mutation regardless of body shape. Gating on
      // `typeof payload === 'string'` would send an empty-bodied success (204) down the failure
      // path and release the lock, letting a retry re-run the side effect it already performed.
      if (isSuccess) {
        const body = replayableBody(payload);
        if (body === undefined) {
          // Streams/Buffers can't be captured for byte-exact replay without consuming them. Leave
          // the record pending so a duplicate gets 409 rather than re-executing the mutation.
          reportError(
            `idempotency cannot replay a non-text ${status} body; leaving key pending until TTL`,
          );
        } else {
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
      } else if (status === HttpStatus.GATEWAY_TIMEOUT) {
        // Timeout cannot cancel the underlying promise. Retain the pending record until its TTL so
        // a retry cannot overlap work that may still commit after the 504 reaches the client.
      } else {
        // Ordinary failures completed their handler path, so the same operation may retry.
        await store.release(ctx.storeKey, ctx.ownerToken);
      }
    } catch (err) {
      reportError(`idempotency finalize failed: ${(err as Error).message}`);
    }

    return payload;
  });
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
