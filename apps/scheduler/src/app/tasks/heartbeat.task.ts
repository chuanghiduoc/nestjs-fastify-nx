import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

@Injectable()
export class HeartbeatTask {
  private readonly logger = new Logger(HeartbeatTask.name);
  // Skip a tick while a prior ping is still in flight (DB hung) so probes don't pile up.
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  // Not leader-gated: each replica has its own Prisma pool, so a follower's connectivity has to be
  // checked on that follower — gating it would leave a degraded follower undetected until promoted.
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'UTC' })
  async ping(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
      this.logger.debug('DB heartbeat OK');
    } catch (error) {
      this.logger.error(`DB heartbeat FAILED: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
