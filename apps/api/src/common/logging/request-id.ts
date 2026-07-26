import type { IncomingMessage } from 'node:http';
import { isValidTraceId, trace } from '@opentelemetry/api';
import { generateCorrelationId } from '@nestjs-fastify-nx/shared';

// Bound any client-supplied id before it flows into every log line / span attribute:
// printable URL-safe chars only (no newlines/control chars → blocks log injection) and a
// hard length cap (blocks log/trace-storage bloat). A value outside this shape is dropped
// and we mint our own id rather than trust the client. 128 covers a UUID, a 32-hex trace id,
// or a Stripe-style opaque token with margin to spare.
const SAFE_CLIENT_ID = /^[A-Za-z0-9._~-]{1,128}$/;

export function sanitizeClientId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_CLIENT_ID.test(value) ? value : undefined;
}

// Trace id of the active span, or undefined when it is absent or all-zeros (unsampled/invalid
// context). Guarding against INVALID_TRACEID stops every unsampled request sharing one id.
export function activeTraceId(): string | undefined {
  const id = trace.getActiveSpan()?.spanContext().traceId;
  return id && isValidTraceId(id) ? id : undefined;
}

// Request id for a request: active trace id → random 128-bit hex. Public callers must not be
// allowed to choose this identifier by default: even a syntactically safe value can be reused to
// make unrelated requests look identical in logs. Trust an upstream gateway's value explicitly.
export function resolveRequestId(headers: Record<string, unknown>): string {
  const inbound =
    process.env['TRUST_INBOUND_REQUEST_ID'] === 'true'
      ? sanitizeClientId(headers['x-request-id'])
      : undefined;
  return inbound ?? activeTraceId() ?? generateCorrelationId();
}

export function resolveCorrelationId(headers: Record<string, unknown>, requestId: string): string {
  return sanitizeClientId(headers['x-correlation-id']) ?? requestId;
}

// The per-request id pair, stamped onto the raw Node request so every layer observes the same value.
export interface RequestIds {
  requestId: string;
  correlationId: string;
}

// The raw Node request is the carrier: it is the one object every layer can reach — Nest middleware
// receives it directly, Fastify hooks via `request.raw` — and it lives exactly as long as the ids
// need to. Intersecting with IncomingMessage (rather than a bare `Partial`) also keeps TypeScript's
// weak-type check meaningful: a caller cannot pass an unrelated object by mistake.
export type RequestIdCarrier = IncomingMessage & Partial<RequestIds>;

/**
 * Resolve-once accessor for a request's ids — the ONLY way any layer should obtain them.
 *
 * `resolveRequestId()` falls back to a fresh random value whenever tracing is off (the default), so
 * calling it twice for the same request yields two different ids. Every response producer that ran
 * its own `resolveRequestId()` — the idempotency plugin, the auth/credential rate limiters, the
 * load-shedding handler, the Better Auth route, Bull Board — therefore handed the client an
 * `X-Request-Id` that appears in no log line, precisely on the error paths where the id is the only
 * way to find the request again.
 *
 * First caller wins and stamps the carrier; everyone after reads it back.
 */
export function ensureRequestIds(
  carrier: RequestIdCarrier,
  headers: Record<string, unknown>,
): RequestIds {
  const requestId = carrier.requestId ?? resolveRequestId(headers);
  const correlationId = carrier.correlationId ?? resolveCorrelationId(headers, requestId);
  carrier.requestId = requestId;
  carrier.correlationId = correlationId;
  return { requestId, correlationId };
}
