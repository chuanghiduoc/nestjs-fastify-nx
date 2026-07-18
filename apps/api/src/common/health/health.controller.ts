import { applyDecorators, Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import { PrismaReplicationLagHealthIndicator } from '@nestjs-fastify-nx/infra-database';
import { MetricsIpAllowGuard } from '../metrics/metrics-ip-allow.guard';
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
      'Per-indicator status. Keys depend on the endpoint — `/health` reports `database`, `memory_heap`, `redis_cache`, `redis_queue`; `/health/ready` reports the subset a pod needs to serve traffic (`database`, `redis_cache`, `redis_queue`); `/health/dependencies` reports the deep checks (`bullmq`, `pgbouncer`, `replication_lag`).',
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

// A health failure is a ServiceUnavailableException the global filter renders as problem+json with
// a `checks` map. @HealthCheck's own swagger is turned off so it cannot document the other shape.
function ApiServiceUnavailableProblem(description: string) {
  return applyDecorators(
    ApiResponse({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      description,
      content: {
        [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } },
      },
    }),
  );
}

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
  @ApiServiceUnavailableProblem('One or more dependencies are unhealthy.')
  @HealthCheck({ noCache: true, swaggerDocumentation: false })
  @ApiOperation({
    summary: 'Full health check (DB + memory + Redis cache + Redis queue).',
    description:
      'Returns 200 with the per-indicator breakdown when everything is up; 503 problem+json (with a `checks` map of the failing dependencies) when at least one critical dependency is down.',
  })
  @ApiOkResponse({ type: HealthCheckResultDto, description: 'All systems healthy.' })
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
  @ApiServiceUnavailableProblem('A core dependency is unreachable.')
  @HealthCheck({ noCache: true, swaggerDocumentation: false })
  @ApiOperation({
    summary: 'Readiness probe (DB primary + Redis cache + Redis queue).',
    description:
      'Use as the Kubernetes readiness probe. Checks ONLY what this pod needs to serve its core traffic. ' +
      'Shared-but-non-blocking dependencies (replica lag, queue depth, pgbouncer) are deliberately excluded: ' +
      'because every replica shares the same Postgres/Redis, wiring them here would flip all pods to NotReady ' +
      'at once on a single dependency blip — a correlated, cluster-wide outage even though the app is healthy. ' +
      'Those live on /health/dependencies for dashboards/alerting instead. Returns 503 so the orchestrator ' +
      'removes the pod from the load balancer when a core dependency is unreachable.',
  })
  @ApiOkResponse({
    type: HealthCheckResultDto,
    description: 'Core dependencies reachable — pod can serve traffic.',
  })
  @ApiCommonErrors({ auth: false, forbidden: false, validation: false })
  readiness() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.redisCache.isHealthy('redis_cache'),
      () => this.redisQueue.isHealthy('redis_queue'),
    ]);
  }

  // Deep checks expose infra topology (BullMQ depth, replica lag, pgbouncer) that /health and
  // /health/ready deliberately do not — restrict to the same trusted-network allowlist as
  // /metrics rather than leaving it @Public() like the LB/k8s probes above.
  @Get('dependencies')
  @UseGuards(MetricsIpAllowGuard)
  @ApiServiceUnavailableProblem('A deep dependency is degraded or unreachable.')
  @HealthCheck({ noCache: true, swaggerDocumentation: false })
  @ApiOperation({
    summary: 'Deep dependency check (BullMQ + pgbouncer + replica lag).',
    description:
      'Deep health of shared infrastructure — meant for dashboards and alerting, NOT for the Kubernetes ' +
      'readiness/liveness probes. Wiring these into a probe would remove every replica from the load balancer ' +
      'at once when a shared dependency degrades. Returns 503 when a deep check fails so alert rules can fire. ' +
      'Restricted to IPs in METRICS_ALLOW_CIDRS (same allowlist as /metrics).',
  })
  @ApiOkResponse({ type: HealthCheckResultDto, description: 'All deep dependencies healthy.' })
  @ApiCommonErrors({ auth: false, forbidden: true, validation: false })
  dependencies() {
    return this.health.check([
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
