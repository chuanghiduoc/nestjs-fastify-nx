import { Injectable } from '@nestjs/common';
import type { CqrsExecutionStatus, CqrsMetricsRecorder } from '@nestjs-fastify-nx/core';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsCqrsRecorderAdapter implements CqrsMetricsRecorder {
  constructor(private readonly metrics: MetricsService) {}

  recordCommand(name: string, status: CqrsExecutionStatus, durationSeconds: number): void {
    this.metrics.cqrsCommandsTotal.inc({ name, status });
    this.metrics.cqrsDurationSeconds.observe({ kind: 'command', name, status }, durationSeconds);
  }

  recordQuery(name: string, status: CqrsExecutionStatus, durationSeconds: number): void {
    this.metrics.cqrsQueriesTotal.inc({ name, status });
    this.metrics.cqrsDurationSeconds.observe({ kind: 'query', name, status }, durationSeconds);
  }
}
