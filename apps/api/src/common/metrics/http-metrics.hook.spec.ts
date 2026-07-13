/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpAdapterHost } from '@nestjs/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpMetricsHook } from './http-metrics.hook';
import { MetricsService } from './metrics.service';

describe('HttpMetricsHook', () => {
  let app: FastifyInstance;
  let metrics: MetricsService;

  beforeEach(() => {
    app = Fastify();
    metrics = new MetricsService();
    metrics.onModuleInit();
    const adapterHost = {
      httpAdapter: { getInstance: () => app },
    } as unknown as HttpAdapterHost;
    new HttpMetricsHook(adapterHost, metrics).onApplicationBootstrap();
  });

  afterEach(async () => {
    metrics.onModuleDestroy();
    await app.close();
  });

  it('records the route template and final rewritten status', async () => {
    app.get('/items/:id', async (_request, reply) => reply.status(503).send({ ok: false }));
    await app.inject('/items/123');

    const output = await metrics.render();
    expect(output).toContain(
      'http_requests_total{method="GET",route="/items/:id",status_code="503",app="api"} 1',
    );
    expect(output).toContain('http_request_duration_seconds_count');
  });

  it('still records a hijacked Fastify response', async () => {
    app.get('/delegated', async (_request, reply) => {
      reply.hijack();
      reply.raw.statusCode = 204;
      reply.raw.end();
    });
    await app.inject('/delegated');

    expect(await metrics.render()).toContain(
      'http_requests_total{method="GET",route="/delegated",status_code="204",app="api"} 1',
    );
  });
});
