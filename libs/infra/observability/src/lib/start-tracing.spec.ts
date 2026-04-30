import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTracing } from './start-tracing';

describe('startTracing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns null when OTEL_ENABLED is not set', () => {
    delete process.env['OTEL_ENABLED'];
    expect(startTracing()).toBeNull();
  });

  it('returns null when OTEL_ENABLED is anything other than "true"', () => {
    process.env['OTEL_ENABLED'] = 'false';
    expect(startTracing()).toBeNull();

    process.env['OTEL_ENABLED'] = '1';
    expect(startTracing()).toBeNull();
  });

  it('boots the SDK when OTEL_ENABLED=true and registers shutdown handlers', () => {
    process.env['OTEL_ENABLED'] = 'true';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://collector.local:4318';
    process.env['OTEL_TRACES_SAMPLER_RATIO'] = '0.25';

    const onceSpy = vi.spyOn(process, 'once');
    const sdk = startTracing({ serviceName: 'unit-test' });

    expect(sdk).not.toBeNull();
    const events = onceSpy.mock.calls.map(([event]) => event);
    expect(events).toContain('SIGTERM');
    expect(events).toContain('SIGINT');
  });
});
