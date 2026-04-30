import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    service.onModuleInit();
  });

  it('exposes default Node process metrics through the registry', async () => {
    const output = await service.render();
    expect(output).toContain('process_cpu_seconds_total');
    expect(output).toContain('nodejs_eventloop_lag_seconds');
  });

  it('records HTTP requests with method/route/status_code labels', async () => {
    service.httpRequestsTotal.inc({ method: 'GET', route: '/api/v1/users', status_code: '200' });
    service.httpRequestDurationSeconds.observe(
      { method: 'GET', route: '/api/v1/users', status_code: '200' },
      0.123,
    );

    const output = await service.render();
    expect(output).toContain('http_requests_total{');
    expect(output).toMatch(/http_requests_total\{[^}]*method="GET"[^}]*\} 1/);
    expect(output).toContain('http_request_duration_seconds_bucket');
  });

  it('records BullMQ jobs with queue/status labels', async () => {
    service.bullmqJobsTotal.inc({ queue: 'email-notification', status: 'completed' });
    service.bullmqJobDurationSeconds.observe(
      { queue: 'email-notification', status: 'completed' },
      0.5,
    );

    const output = await service.render();
    expect(output).toMatch(
      /bullmq_jobs_total\{[^}]*queue="email-notification"[^}]*status="completed"[^}]*\} 1/,
    );
    expect(output).toContain('bullmq_job_duration_seconds_bucket');
  });

  it('returns the standard Prometheus content type', () => {
    expect(service.contentType()).toContain('text/plain');
    expect(service.contentType()).toContain('version=0.0.4');
  });
});
