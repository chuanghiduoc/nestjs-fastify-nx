import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisCacheHealthIndicator, RedisQueueHealthIndicator } from './redis.health';

@ApiTags('health')
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly redisCache: RedisCacheHealthIndicator,
    private readonly redisQueue: RedisQueueHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Full health check (DB + memory + Redis cache + Redis queue)' })
  @ApiResponse({ status: 200, description: 'All systems healthy' })
  @ApiResponse({ status: 503, description: 'One or more systems unhealthy' })
  check() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.redisCache.isHealthy('redis_cache'),
      () => this.redisQueue.isHealthy('redis_queue'),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (DB + Redis cache + Redis queue)' })
  @ApiResponse({ status: 200, description: 'All critical dependencies reachable' })
  @ApiResponse({ status: 503, description: 'A critical dependency is unreachable' })
  readiness() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.redisCache.isHealthy('redis_cache'),
      () => this.redisQueue.isHealthy('redis_queue'),
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — always 200 if process is up' })
  @ApiResponse({ status: 200, description: 'Process is alive' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
