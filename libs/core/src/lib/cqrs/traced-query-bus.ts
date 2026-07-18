import type { AsyncContext, IQuery } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import { instrumentBusExecution } from './instrument-execution';

// Not constructed directly — CqrsInstrumentationInitializer attaches this prototype to the
// app's existing QueryBus singleton (see cqrs-instrumentation.initializer.ts for why), so
// every constructor-injected `QueryBus` gains this override with zero callsite changes.
export class TracedQueryBus extends QueryBus {
  // Callers inject the base `QueryBus`, so they keep the typed `Query<TResult>` inference — this
  // override only has to stay assignable to the base's untyped legacy overload. `unknown` (not the
  // base's `any`) as the fallback keeps that assignable without reintroducing `any` here.
  override execute<T extends IQuery, TResult = unknown>(
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
