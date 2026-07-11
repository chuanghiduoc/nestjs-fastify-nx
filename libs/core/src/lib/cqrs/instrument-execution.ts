import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { CqrsExecutionStatus } from './cqrs-metrics-recorder.port';

// Lazily resolved against whatever global tracer provider is registered — a no-op provider
// (the OTel API default when OTEL_ENABLED=false) makes every call below a cheap no-op, so this
// stays safe to run unconditionally.
const tracer = trace.getTracer('cqrs');

function messageName(message: unknown): string {
  return (message as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
}

// Shared by TracedCommandBus/TracedQueryBus — spans `${spanPrefix}.<MessageClassName>`,
// reports duration + outcome through `recordMetric` (a no-op recorder is the caller's problem,
// not this function's), and re-throws so the caller's error handling is unaffected.
export function instrumentBusExecution<TResult>(
  spanPrefix: 'command' | 'query',
  message: unknown,
  execute: () => Promise<TResult>,
  recordMetric: (name: string, status: CqrsExecutionStatus, durationSeconds: number) => void,
): Promise<TResult> {
  const name = messageName(message);
  return tracer.startActiveSpan(`${spanPrefix}.${name}`, async (span) => {
    const startedAt = process.hrtime.bigint();
    const finish = (status: CqrsExecutionStatus): void => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      recordMetric(name, status, durationSeconds);
    };
    try {
      const result = await execute();
      span.setStatus({ code: SpanStatusCode.OK });
      finish('success');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      finish('error');
      throw err;
    } finally {
      span.end();
    }
  });
}
