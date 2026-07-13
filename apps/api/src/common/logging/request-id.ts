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

// Request id for a request: validated client header → active trace id → random hex.
export function resolveRequestId(headers: Record<string, unknown>): string {
  return sanitizeClientId(headers['x-request-id']) ?? activeTraceId() ?? generateCorrelationId();
}
