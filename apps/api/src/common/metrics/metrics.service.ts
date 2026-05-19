import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Buckets in seconds — sized for HTTP API latencies. Anything slower than 5s
 * lands in the +Inf bucket and triggers latency SLO alerts.
 */
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

/**
 * Buckets in seconds — sized for BullMQ jobs (typically 50ms..30s).
 */
const JOB_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

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

  /**
   * Polled every 30s by QueueDepthCollector. Tells the operator whether
   * workers are keeping up — rising `waiting` count means under-provisioned.
   */
  readonly bullmqQueueDepth = new Gauge({
    name: 'bullmq_queue_depth',
    help: 'Number of jobs per queue per state',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });

  /**
   * Polled every 30s by OutboxLagCollector. Age of the oldest unprocessed
   * outbox event — the signal to extract the relay into its own process if
   * sustained saturation is observed.
   */
  readonly outboxLagSeconds = new Gauge({
    name: 'outbox_lag_seconds',
    help: 'Age of the oldest unprocessed outbox event in seconds',
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
