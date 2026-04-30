import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import type { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: FastifyReply): Promise<void> {
    res.header('Content-Type', this.metrics.contentType());
    res.send(await this.metrics.render());
  }
}
