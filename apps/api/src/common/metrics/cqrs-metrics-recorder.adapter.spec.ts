import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from './metrics.service';
import { MetricsCqrsRecorderAdapter } from './cqrs-metrics-recorder.adapter';

describe('MetricsCqrsRecorderAdapter', () => {
  let metrics: MetricsService;
  let adapter: MetricsCqrsRecorderAdapter;

  beforeEach(() => {
    metrics = new MetricsService();
    metrics.onModuleInit();
    adapter = new MetricsCqrsRecorderAdapter(metrics);
  });

  it('records a command outcome as a counter + labeled histogram observation', async () => {
    adapter.recordCommand('CreateUser', 'success', 0.02);

    const output = await metrics.render();
    expect(output).toMatch(
      /cqrs_commands_total\{[^}]*name="CreateUser"[^}]*status="success"[^}]*\} 1/,
    );
    expect(output).toMatch(/cqrs_duration_seconds_bucket\{[^}]*kind="command"[^}]*\}/);
  });

  it('records a query outcome as a counter + labeled histogram observation', async () => {
    adapter.recordQuery('FindUserById', 'error', 0.01);

    const output = await metrics.render();
    expect(output).toMatch(
      /cqrs_queries_total\{[^}]*name="FindUserById"[^}]*status="error"[^}]*\} 1/,
    );
    expect(output).toMatch(/cqrs_duration_seconds_bucket\{[^}]*kind="query"[^}]*\}/);
  });
});
