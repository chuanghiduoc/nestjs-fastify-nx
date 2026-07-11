import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// Sized for HTTP API latencies; >5s lands in +Inf and triggers latency SLO alerts.
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

// Sized for BullMQ jobs (typically 50ms–30s).
const JOB_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// Sized for in-process CQRS dispatch (sub-millisecond to a few hundred ms; no network hop).
const CQRS_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests handled by the API',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: HTTP_DURATION_BUCKETS,
    registers: [this.registry],
  });

  readonly bullmqJobsTotal = new Counter({
    name: 'bullmq_jobs_total',
    help: 'Total BullMQ jobs observed by terminal status',
    labelNames: ['queue', 'status'] as const,
    registers: [this.registry],
  });

  readonly bullmqJobDurationSeconds = new Histogram({
    name: 'bullmq_job_duration_seconds',
    help: 'BullMQ job processing duration in seconds (active → completed/failed)',
    labelNames: ['queue', 'status'] as const,
    buckets: JOB_DURATION_BUCKETS,
    registers: [this.registry],
  });

  readonly bullmqQueueDepth = new Gauge({
    name: 'bullmq_queue_depth',
    help: 'Number of jobs per queue per state',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });

  readonly outboxLagSeconds = new Gauge({
    name: 'outbox_lag_seconds',
    help: 'Age of the oldest unprocessed outbox event in seconds',
    registers: [this.registry],
  });

  // CQRS handlers have no auto-instrumentation (unlike http/pg/redis) — see
  // CqrsInstrumentationInitializer in @nestjs-fastify-nx/core, which drives these series.
  readonly cqrsCommandsTotal = new Counter({
    name: 'cqrs_commands_total',
    help: 'Total CQRS commands executed by name and outcome',
    labelNames: ['name', 'status'] as const,
    registers: [this.registry],
  });

  readonly cqrsQueriesTotal = new Counter({
    name: 'cqrs_queries_total',
    help: 'Total CQRS queries executed by name and outcome',
    labelNames: ['name', 'status'] as const,
    registers: [this.registry],
  });

  readonly cqrsDurationSeconds = new Histogram({
    name: 'cqrs_duration_seconds',
    help: 'CQRS command/query execution duration in seconds',
    labelNames: ['kind', 'name', 'status'] as const,
    buckets: CQRS_DURATION_BUCKETS,
    registers: [this.registry],
  });

  onModuleInit(): void {
    this.registry.setDefaultLabels({ app: 'api' });
    collectDefaultMetrics({ register: this.registry });
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
