import type { CqrsMetricsRecorder } from './cqrs-metrics-recorder.port';

// TracedCommandBus/TracedQueryBus are attached to the app's existing CommandBus/QueryBus
// singleton via prototype reassignment (see cqrs-instrumentation.initializer.ts), not via a
// `new TracedCommandBus(...)` construction — @nestjs/cqrs's CqrsModule owns bus instantiation
// and handler registration internally, so a DI-token override (`{ provide: CommandBus, useClass
// }`) never reaches feature-module-hosted controllers/listeners that resolve CommandBus through
// the global module (Nest's per-module import resolution finds CqrsModule's own instance first).
// Because the subclass constructor never runs, the metrics recorder can't be an instance field —
// this static holder is the DI-free equivalent of nestjs-cls's ClsServiceManager.
export class CqrsMetricsRecorderHolder {
  private static recorder: CqrsMetricsRecorder | undefined;

  static set(recorder: CqrsMetricsRecorder | undefined): void {
    CqrsMetricsRecorderHolder.recorder = recorder;
  }

  static get(): CqrsMetricsRecorder | undefined {
    return CqrsMetricsRecorderHolder.recorder;
  }
}
