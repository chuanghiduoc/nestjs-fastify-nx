import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

@Injectable()
export class HeartbeatTask {
  private readonly logger = new Logger(HeartbeatTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  // Ping the DB every minute to detect connectivity issues early.
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'UTC' })
  async ping(): Promise<void> {
    if (!this.leadership.isLeader()) return;
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
      this.logger.debug('DB heartbeat OK');
    } catch (error) {
      this.logger.error(`DB heartbeat FAILED: ${String(error)}`);
    }
  }
}
