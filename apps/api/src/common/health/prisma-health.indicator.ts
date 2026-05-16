import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

const PROBE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Health probe timed out after ${ms}ms`)), ms),
    ),
  ]);
}

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await withTimeout(this.prisma.db.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Prisma health check failed',
        this.getStatus(key, false, { error: String(error) }),
      );
    }
  }
}
