import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MetricsService } from './metrics.service';

const ROUTE_UNKNOWN = 'unmatched';
const REQUEST_START_KEY = '__metricsStartedAt';

// Uses Fastify onResponse (not NestInterceptor) so the recorded status reflects
// exception-filter rewrites. Route template keeps label cardinality bounded.
@Injectable()
export class HttpMetricsHook implements OnApplicationBootstrap {
  private readonly logger = new Logger(HttpMetricsHook.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify) {
      this.logger.warn('Fastify instance not available; HTTP metrics disabled');
      return;
    }

    fastify.addHook('onRequest', (request, _reply, done) => {
      (request as unknown as Record<string, number>)[REQUEST_START_KEY] = Date.now();
      done();
    });

    fastify.addHook('onResponse', (request, reply, done) => {
      try {
        this.record(request, reply);
      } catch (err) {
        this.logger.error('Failed to record HTTP metric', err as Error);
      }
      done();
    });
  }

  private record(request: FastifyRequest, reply: FastifyReply): void {
    const startedAt = (request as unknown as Record<string, number>)[REQUEST_START_KEY];
    if (typeof startedAt !== 'number') return;

    const durationSeconds = (Date.now() - startedAt) / 1000;
    const method = request.method.toUpperCase();
    const route = request.routeOptions?.url ?? ROUTE_UNKNOWN;
    const statusCode = String(reply.statusCode);

    const labels = { method, route, status_code: statusCode };
    this.metrics.httpRequestsTotal.inc(labels);
    this.metrics.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }
}
