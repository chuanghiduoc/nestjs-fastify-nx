import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'fs';
import { LivenessProbeService } from './liveness-probe.service';

vi.mock('fs', () => ({ writeFileSync: vi.fn() }));

const writeMock = vi.mocked(writeFileSync);

describe('LivenessProbeService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('writes an ISO timestamp probe immediately on bootstrap and on every interval tick', () => {
    const service = new LivenessProbeService({ probeFile: '/tmp/test-alive', name: 'Test' });

    service.onApplicationBootstrap();
    expect(writeMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(writeMock).toHaveBeenCalledTimes(3);

    service.onApplicationShutdown();
    vi.advanceTimersByTime(120_000);
    expect(writeMock).toHaveBeenCalledTimes(3);
    expect(writeMock.mock.calls[0][0]).toBe('/tmp/test-alive');
    expect(() => new Date(String(writeMock.mock.calls[0][1]))).not.toThrow();
  });

  it('honours a custom interval', () => {
    const service = new LivenessProbeService({
      probeFile: '/tmp/test-alive',
      name: 'Test',
      intervalMs: 5_000,
    });

    service.onApplicationBootstrap();
    vi.advanceTimersByTime(10_000);
    expect(writeMock).toHaveBeenCalledTimes(3);
    service.onApplicationShutdown();
  });

  it('logs a failed probe write instead of crashing the timer loop', () => {
    writeMock.mockImplementation(() => {
      throw new Error('ENOSPC');
    });
    const service = new LivenessProbeService({ probeFile: '/tmp/test-alive', name: 'Test' });
    const warnSpy = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    expect(() => {
      service.onApplicationBootstrap();
      vi.advanceTimersByTime(30_000);
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      { err: expect.any(Error), probeFile: '/tmp/test-alive' },
      'failed to refresh health probe',
    );
    service.onApplicationShutdown();
  });
});
