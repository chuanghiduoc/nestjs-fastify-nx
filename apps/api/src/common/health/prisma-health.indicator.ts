import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

const PROBE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Always clearTimeout in finally — otherwise the closure blocks clean shutdown.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
