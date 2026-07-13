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
