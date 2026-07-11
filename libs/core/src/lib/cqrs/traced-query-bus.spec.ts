import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { QueryBus } from '@nestjs/cqrs';
import type { ModuleRef } from '@nestjs/core';
import { TracedQueryBus } from './traced-query-bus';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import type { CqrsMetricsRecorder } from './cqrs-metrics-recorder.port';

class FindUser {}

describe('TracedQueryBus', () => {
  // See traced-command-bus.spec.ts — one global tracer provider registration per suite,
  // reset the in-memory exporter's captured spans between tests instead of re-registering.
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

  it('starts a query.<Name> span and records a success metric', async () => {
    const bus = new TracedQueryBus({} as ModuleRef);
    vi.spyOn(QueryBus.prototype, 'execute').mockResolvedValue({ id: '1' });

    const result = await bus.execute(new FindUser());

    expect(result).toEqual({ id: '1' });
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('query.FindUser');
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    expect(recorder.recordQuery).toHaveBeenCalledWith('FindUser', 'success', expect.any(Number));
  });

  it('records the exception, sets an error span status, and re-throws on failure', async () => {
    const bus = new TracedQueryBus({} as ModuleRef);
    const error = new Error('not found');
    vi.spyOn(QueryBus.prototype, 'execute').mockRejectedValue(error);

    await expect(bus.execute(new FindUser())).rejects.toThrow('not found');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].events.some((event) => event.name === 'exception')).toBe(true);
    expect(recorder.recordQuery).toHaveBeenCalledWith('FindUser', 'error', expect.any(Number));
  });

  it('does not throw when no metrics recorder is registered', async () => {
    CqrsMetricsRecorderHolder.set(undefined);
    const bus = new TracedQueryBus({} as ModuleRef);
    vi.spyOn(QueryBus.prototype, 'execute').mockResolvedValue({ id: '1' });

    await expect(bus.execute(new FindUser())).resolves.toEqual({ id: '1' });
  });
});
