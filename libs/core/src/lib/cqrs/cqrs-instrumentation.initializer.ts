import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CQRS_METRICS_RECORDER, type CqrsMetricsRecorder } from './cqrs-metrics-recorder.port';
import { CqrsMetricsRecorderHolder } from './cqrs-metrics-recorder.holder';
import { TracedCommandBus } from './traced-command-bus';
import { TracedQueryBus } from './traced-query-bus';

// Add to the root module's `providers` (alongside `CqrsModule.forRoot()`) in any app that
// dispatches commands/queries — see apps/api and apps/scheduler AppModule. No further wiring
// needed: this attaches tracing/metrics to the app's single CommandBus/QueryBus instance in
// place, so every existing `commandBus.execute()`/`queryBus.execute()` callsite is instrumented
// without changes. The metrics recorder is optional — apps without a Prometheus registry (e.g.
// the scheduler) still get tracing spans, just no `cqrs_*` series.
@Injectable()
export class CqrsInstrumentationInitializer implements OnModuleInit {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    @Optional()
    @Inject(CQRS_METRICS_RECORDER)
    private readonly metricsRecorder?: CqrsMetricsRecorder,
  ) {}

  onModuleInit(): void {
    CqrsMetricsRecorderHolder.set(this.metricsRecorder);
    Object.setPrototypeOf(this.commandBus, TracedCommandBus.prototype);
    Object.setPrototypeOf(this.queryBus, TracedQueryBus.prototype);
  }
}
