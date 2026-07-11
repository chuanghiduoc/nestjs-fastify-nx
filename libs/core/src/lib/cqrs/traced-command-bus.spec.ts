import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { CommandBus } from '@nestjs/cqrs';
import type { ModuleRef } from '@nestjs/core';
import { TracedCommandBus } from './traced-command-bus';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import type { CqrsMetricsRecorder } from './cqrs-metrics-recorder.port';

class Ping {}

describe('TracedCommandBus', () => {
  // @opentelemetry/api only allows one global tracer provider registration per process —
  // re-registering per test (e.g. via trace.disable() + setGlobalTracerProvider in
  // beforeEach/afterEach) silently drops later registrations. Register once for the suite
  // and reset the in-memory exporter's captured spans between tests instead.
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let recorder: CqrsMetricsRecorder;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(async () => {
    trace.disable();
    await provider.shutdown();
  });

  beforeEach(() => {
    exporter.reset();
    recorder = { recordCommand: vi.fn(), recordQuery: vi.fn() };
    CqrsMetricsRecorderHolder.set(recorder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    CqrsMetricsRecorderHolder.set(undefined);
  });

  it('starts a command.<Name> span and records a success metric', async () => {
    const bus = new TracedCommandBus({} as ModuleRef);
    vi.spyOn(CommandBus.prototype, 'execute').mockResolvedValue('ok');

    const result = await bus.execute(new Ping());

    expect(result).toBe('ok');
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('command.Ping');
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    expect(recorder.recordCommand).toHaveBeenCalledWith('Ping', 'success', expect.any(Number));
  });

  it('records the exception, sets an error span status, and re-throws on failure', async () => {
    const bus = new TracedCommandBus({} as ModuleRef);
    const error = new Error('boom');
    vi.spyOn(CommandBus.prototype, 'execute').mockRejectedValue(error);

    await expect(bus.execute(new Ping())).rejects.toThrow('boom');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].events.some((event) => event.name === 'exception')).toBe(true);
    expect(recorder.recordCommand).toHaveBeenCalledWith('Ping', 'error', expect.any(Number));
  });

  it('does not throw when no metrics recorder is registered', async () => {
    CqrsMetricsRecorderHolder.set(undefined);
    const bus = new TracedCommandBus({} as ModuleRef);
    vi.spyOn(CommandBus.prototype, 'execute').mockResolvedValue('ok');

    await expect(bus.execute(new Ping())).resolves.toBe('ok');
  });
});
