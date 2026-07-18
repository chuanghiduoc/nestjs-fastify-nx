import type { AsyncContext, ICommand } from '@nestjs/cqrs';
import { CommandBus } from '@nestjs/cqrs';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import { instrumentBusExecution } from './instrument-execution';

// Not constructed directly — CqrsInstrumentationInitializer attaches this prototype to the
// app's existing CommandBus singleton (see cqrs-instrumentation.initializer.ts for why), so
// every constructor-injected `CommandBus` gains this override with zero callsite changes.
export class TracedCommandBus extends CommandBus {
  // Callers inject the base `CommandBus`, so they keep the typed `Command<R>` inference — this
  // override only has to stay assignable to the base's untyped legacy overload. `unknown` (not the
  // base's `any`) as the fallback keeps that assignable without reintroducing `any` here.
  override execute<T extends ICommand, R = unknown>(
    command: T,
    context?: AsyncContext,
  ): Promise<R> {
    return instrumentBusExecution<R>(
      'command',
      command,
      () => super.execute<T, R>(command, context),
      (name, status, durationSeconds) =>
        CqrsMetricsRecorderHolder.get()?.recordCommand(name, status, durationSeconds),
    );
  }
}
