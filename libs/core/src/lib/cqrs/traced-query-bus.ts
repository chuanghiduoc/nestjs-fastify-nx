import type { AsyncContext, IQuery } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import { instrumentBusExecution } from './instrument-execution';

// Not constructed directly — CqrsInstrumentationInitializer attaches this prototype to the
// app's existing QueryBus singleton (see cqrs-instrumentation.initializer.ts for why), so
// every constructor-injected `QueryBus` gains this override with zero callsite changes.
export class TracedQueryBus extends QueryBus {
  // `TResult = any` mirrors QueryBus's own overload set exactly — narrowing the default
  // here would make this override incompatible with the base class's public signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override execute<T extends IQuery, TResult = any>(
    query: T,
    asyncContext?: AsyncContext,
  ): Promise<TResult> {
    // QueryBus's 2-arg overload requires a defined AsyncContext (unlike CommandBus's, which
    // accepts undefined) — dispatch to the 1-arg overload when the caller omitted it.
    return instrumentBusExecution<TResult>(
      'query',
      query,
      () =>
        asyncContext
          ? super.execute<T, TResult>(query, asyncContext)
          : super.execute<T, TResult>(query),
      (name, status, durationSeconds) =>
        CqrsMetricsRecorderHolder.get()?.recordQuery(name, status, durationSeconds),
    );
  }
}
