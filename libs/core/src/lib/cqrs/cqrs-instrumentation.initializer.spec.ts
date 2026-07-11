import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { ModuleRef } from '@nestjs/core';
import { CqrsInstrumentationInitializer } from './cqrs-instrumentation.initializer';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import { TracedCommandBus } from './traced-command-bus';
import { TracedQueryBus } from './traced-query-bus';
import type { CqrsMetricsRecorder } from './cqrs-metrics-recorder.port';

describe('CqrsInstrumentationInitializer', () => {
  afterEach(() => {
    CqrsMetricsRecorderHolder.set(undefined);
  });

  it('attaches the traced prototypes to the existing bus singletons in place', () => {
    const commandBus = new CommandBus({} as ModuleRef);
    const queryBus = new QueryBus({} as ModuleRef);

    const initializer = new CqrsInstrumentationInitializer(commandBus, queryBus);
    initializer.onModuleInit();

    // Identity is preserved — every existing DI consumer holding a reference to these
    // exact objects transparently gains the traced execute() override.
    expect(commandBus).toBeInstanceOf(TracedCommandBus);
    expect(queryBus).toBeInstanceOf(TracedQueryBus);
  });

  it('registers the optional metrics recorder in the holder when provided', () => {
    const commandBus = new CommandBus({} as ModuleRef);
    const queryBus = new QueryBus({} as ModuleRef);
    const recorder: CqrsMetricsRecorder = { recordCommand: vi.fn(), recordQuery: vi.fn() };

    const initializer = new CqrsInstrumentationInitializer(commandBus, queryBus, recorder);
    initializer.onModuleInit();

    expect(CqrsMetricsRecorderHolder.get()).toBe(recorder);
  });

  it('clears the holder when no metrics recorder is wired (e.g. scheduler app)', () => {
    CqrsMetricsRecorderHolder.set({ recordCommand: vi.fn(), recordQuery: vi.fn() });
    const commandBus = new CommandBus({} as ModuleRef);
    const queryBus = new QueryBus({} as ModuleRef);

    const initializer = new CqrsInstrumentationInitializer(commandBus, queryBus);
    initializer.onModuleInit();

    expect(CqrsMetricsRecorderHolder.get()).toBeUndefined();
  });
});
