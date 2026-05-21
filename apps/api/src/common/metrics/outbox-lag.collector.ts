import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { MetricsService } from './metrics.service';

@Injectable()
export class OutboxLagCollector {
  private readonly logger = new Logger(OutboxLagCollector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Interval(30_000)
  async collect(): Promise<void> {
    try {
      const rows = await this.prisma.db.$queryRawUnsafe<[{ lag_seconds: number | null }]>(
        `SELECT EXTRACT(EPOCH FROM NOW() - MIN("createdAt"))::float AS lag_seconds
           FROM "outbox_events"
          WHERE "processedAt" IS NULL`,
      );
      this.metrics.outboxLagSeconds.set(rows[0]?.lag_seconds ?? 0);
    } catch (err) {
      // Non-fatal — metric is stale until next tick.
      this.logger.warn(`Outbox lag collector failed: ${String(err)}`);
    }
  }
}
