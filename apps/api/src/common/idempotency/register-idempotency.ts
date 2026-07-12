import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { resolveRequestId } from '../logging/request-id';
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
const PROBLEM_CONTENT_TYPE = 'application/problem+json';

interface IdempotencyContext {
  storeKey: string;
  fingerprint: string;
}

interface RequestWithIdempotency extends FastifyRequest {
  idempotency?: IdempotencyContext;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Authenticated requests scope by session token, anonymous ones by client IP. Two principals thus
// never collide on — nor replay — each other's cached response for the same key.
function extractPrincipal(req: FastifyRequest): string {
  const cookie = req.headers.cookie;
  if (typeof cookie === 'string') {
    const match = cookie.match(/better-auth\.session_token=([^;]+)/);
    if (match) return `s:${match[1]}`;
  }
  return `ip:${req.ip}`;
}

// Method + full URL (query included) + body. Detects a key reused for a different operation.
function buildFingerprint(req: FastifyRequest): string {
  return sha256(`${req.method}\n${req.url}\n${JSON.stringify(req.body ?? null)}`);
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
  return reply
    .status(status)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .header('x-request-id', requestId)
    .send({
      type: 'about:blank',
      title,
      status,
      code,
      detail,
      instance: req.url,
      requestId,
      timestamp: new Date().toISOString(),
    });
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
      (req as RequestWithIdempotency).idempotency = { storeKey, fingerprint };
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
    return reply
      .status(record.status ?? 200)
      .header('content-type', record.contentType ?? 'application/json')
      .header(REPLAYED_HEADER, 'true')
      .header('x-request-id', resolveRequestId(req.headers))
      .send(record.body);
  });

  fastify.addHook('onSend', async (req, reply, payload) => {
    const ctx = (req as RequestWithIdempotency).idempotency;
    if (!ctx) return payload;

    try {
      const status = reply.statusCode;
      if (status >= 200 && status < 300 && typeof payload === 'string') {
        await store.complete(ctx.storeKey, {
          fingerprint: ctx.fingerprint,
          status,
          contentType: String(reply.getHeader('content-type') ?? 'application/json'),
          body: payload,
        });
      } else {
        // Non-2xx (including the 504 from TimeoutInterceptor): release the lock so the client may
        // retry. Safe because command handlers roll back their transaction on error — a failed
        // request leaves no committed side effect to duplicate.
        await store.release(ctx.storeKey);
      }
    } catch (err) {
      reportError(`idempotency finalize failed: ${(err as Error).message}`);
    }

    return payload;
  });
}
