import { isValidTraceId, trace } from '@opentelemetry/api';
import { generateCorrelationId } from '@nestjs-fastify-nx/shared';

// Trace id of the active span, or undefined when it is absent or all-zeros (unsampled/invalid
// context). Guarding against INVALID_TRACEID stops every unsampled request sharing one id.
export function activeTraceId(): string | undefined {
  const id = trace.getActiveSpan()?.spanContext().traceId;
  return id && isValidTraceId(id) ? id : undefined;
}

// Correlation id for a request: client header → active trace id → random hex.
export function resolveRequestId(headers: Record<string, unknown>): string {
  const header = headers['x-request-id'];
  return (typeof header === 'string' && header) || activeTraceId() || generateCorrelationId();
}
