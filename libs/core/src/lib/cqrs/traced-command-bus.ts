import type { AsyncContext, ICommand } from '@nestjs/cqrs';
import { CommandBus } from '@nestjs/cqrs';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import { instrumentBusExecution } from './instrument-execution';

// Not constructed directly — CqrsInstrumentationInitializer attaches this prototype to the
// app's existing CommandBus singleton (see cqrs-instrumentation.initializer.ts for why), so
// every constructor-injected `CommandBus` gains this override with zero callsite changes.
export class TracedCommandBus extends CommandBus {
  // `R = any` mirrors CommandBus's own overload set exactly — narrowing the default here
  // would make this override incompatible with the base class's public signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override execute<T extends ICommand, R = any>(command: T, context?: AsyncContext): Promise<R> {
    return instrumentBusExecution<R>(
      'command',
      command,
      () => super.execute<T, R>(command, context),
      (name, status, durationSeconds) =>
        CqrsMetricsRecorderHolder.get()?.recordCommand(name, status, durationSeconds),
    );
  }
}
