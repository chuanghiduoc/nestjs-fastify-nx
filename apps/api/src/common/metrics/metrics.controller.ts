import { Controller, Get, Res, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import type { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';
import { MetricsIpAllowGuard } from './metrics-ip-allow.guard';

// Prometheus scrape endpoint — internal-only, IP-allowlist guarded; response is
// `text/plain; version=0.0.4`, not JSON, so it carries no value in the public OpenAPI spec.
// VERSION_NEUTRAL keeps the route at /metrics; enableVersioning('1') in main.ts
// would otherwise rewrite it to /v1/metrics and break Prometheus scrape configs.
// The setGlobalPrefix exclude only strips the `api` prefix — URI versioning is a
// separate concern that the controller has to opt out of explicitly.
@ApiExcludeController()
@Public()
@SkipThrottle()
@UseGuards(MetricsIpAllowGuard)
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: FastifyReply): Promise<void> {
    res.header('Content-Type', this.metrics.contentType());
    res.send(await this.metrics.render());
  }
}
