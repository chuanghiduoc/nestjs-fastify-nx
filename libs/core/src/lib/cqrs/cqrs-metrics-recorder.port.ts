export type CqrsExecutionStatus = 'success' | 'error';

// Implemented by an infra-level adapter over the app's Prometheus registry (see
// apps/api MetricsCqrsRecorderAdapter). Kept as a port here so libs/core — which the
// traced bus classes live in — never depends on prom-client or a concrete metrics module.
export interface CqrsMetricsRecorder {
  recordCommand(name: string, status: CqrsExecutionStatus, durationSeconds: number): void;
  recordQuery(name: string, status: CqrsExecutionStatus, durationSeconds: number): void;
}

export const CQRS_METRICS_RECORDER = Symbol('CQRS_METRICS_RECORDER');
