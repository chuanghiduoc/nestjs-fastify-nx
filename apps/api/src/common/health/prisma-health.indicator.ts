import { Injectable, Logger } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

const PROBE_TIMEOUT_MS = 2_000;
// Sanitized marker — raw Prisma/libpq errors leak connection-string segments and topology into
// the public /health response. Log the real cause server-side, expose only the fixed marker.
const SANITIZED_ERROR = 'probe_failed';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Always clearTimeout in finally — otherwise the closure blocks clean shutdown.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class PrismaHealthIndicator {
  private readonly logger = new Logger(PrismaHealthIndicator.name);

  constructor(
    private readonly healthIndicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicator.check(key);
    try {
      await withTimeout(this.prisma.db.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
      return indicator.up();
    } catch (error) {
      this.logger.warn(`database readiness probe failed: ${String(error)}`);
      return indicator.down({ error: SANITIZED_ERROR });
    }
  }
}
