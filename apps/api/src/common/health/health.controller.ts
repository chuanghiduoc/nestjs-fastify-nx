import { Controller, Get, HttpStatus } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import { PrismaReplicationLagHealthIndicator } from '@nestjs-fastify-nx/infra-database';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisCacheHealthIndicator, RedisQueueHealthIndicator } from './redis.health';
import { BullMqHealthIndicator } from './bullmq-health.indicator';
import { PgBouncerHealthIndicator } from './pgbouncer-health.indicator';

// 80% of cgroup limit — headroom for GC pauses; falls back to 1 GiB when cgroup is undetectable.
function resolveHeapThreshold(): number {
  const max = (
    process as NodeJS.Process & { constrainedMemory?: () => number }
  ).constrainedMemory?.();
  if (typeof max === 'number' && max > 0) {
    return Math.floor(max * 0.8);
  }
  return 1024 * 1024 * 1024;
}

const HEAP_THRESHOLD_BYTES = resolveHeapThreshold();

// @nestjs/swagger 11.4.3+ stopped re-exporting SchemaObject — redeclare minimal shape to stay bump-safe.
type IndicatorSchema = {
  type: 'object';
  required: string[];
  properties: Record<string, { type: 'string'; enum: string[] }>;
};

const INDICATOR_STATUS_SCHEMA: IndicatorSchema = {
  type: 'object',
  required: ['status'],
  properties: { status: { type: 'string', enum: ['up', 'down'] } },
};

class HealthCheckResultDto {
  @ApiProperty({
    enum: ['ok', 'error', 'shutting_down'],
    description: 'Aggregate health status.',
    example: 'ok',
  })
  status!: 'ok' | 'error' | 'shutting_down';

  @ApiProperty({
    description:
      'Per-indicator status. Keys: `database`, `memory_heap`, `redis_cache`, `redis_queue`.',
    type: 'object',
    additionalProperties: INDICATOR_STATUS_SCHEMA,
    example: { database: { status: 'up' }, memory_heap: { status: 'up' } },
  })
  info!: Record<string, { status: 'up' | 'down' }>;

  @ApiProperty({
    description: 'Indicators that reported `down`. Empty when `status === "ok"`.',
    type: 'object',
    additionalProperties: INDICATOR_STATUS_SCHEMA,
    example: {},
  })
  error!: Record<string, { status: 'up' | 'down' }>;

  @ApiProperty({
    description: 'Mirror of `info` plus failed indicators — convenient for UI rendering.',
    type: 'object',
    additionalProperties: INDICATOR_STATUS_SCHEMA,
    example: { database: { status: 'up' }, memory_heap: { status: 'up' } },
  })
  details!: Record<string, { status: 'up' | 'down' }>;
}

class LivenessResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ format: 'date-time', example: '2026-04-30T22:28:27.356Z' })
  timestamp!: string;
}

const PROBLEM_JSON = 'application/problem+json';

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
    private readonly bullmq: BullMqHealthIndicator,
    private readonly pgbouncer: PgBouncerHealthIndicator,
    private readonly replicationLag: PrismaReplicationLagHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Full health check (DB + memory + Redis cache + Redis queue).',
    description:
      'Returns 200 with the per-indicator breakdown when everything is up; 503 with a Problem Details payload when at least one critical dependency is down.',
  })
  @ApiOkResponse({ type: HealthCheckResultDto, description: 'All systems healthy.' })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'One or more dependencies are unhealthy.',
    content: {
      [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } },
    },
  })
  @ApiCommonErrors({ auth: false, forbidden: false, validation: false })
  check() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', HEAP_THRESHOLD_BYTES),
      () => this.redisCache.isHealthy('redis_cache'),
      () => this.redisQueue.isHealthy('redis_queue'),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe (DB + Redis cache + Redis queue + BullMQ).',
    description:
      'Use as the Kubernetes readiness probe. Returns 503 when any critical dependency is unreachable so the orchestrator removes the pod from the load balancer.',
  })
  @ApiOkResponse({
    type: HealthCheckResultDto,
    description: 'All critical dependencies reachable.',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'A critical dependency is unreachable.',
    content: {
      [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } },
    },
  })
  @ApiCommonErrors({ auth: false, forbidden: false, validation: false })
  readiness() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.redisCache.isHealthy('redis_cache'),
      () => this.redisQueue.isHealthy('redis_queue'),
      () => this.bullmq.isHealthy('bullmq'),
      // no-op when DATABASE_DIRECT_URL unset
      () => this.pgbouncer.isHealthy('pgbouncer'),
      // no-op when DATABASE_REPLICA_URL unset
      () => this.replicationLag.isHealthy('replication_lag'),
    ]);
  }

  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe — always 200 if the process is up.',
    description: 'Use as the Kubernetes liveness probe. Does not check dependencies.',
  })
  @ApiOkResponse({ type: LivenessResponseDto, description: 'Process is alive.' })
  @ApiCommonErrors({ auth: false, forbidden: false, validation: false })
  liveness(): LivenessResponseDto {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
