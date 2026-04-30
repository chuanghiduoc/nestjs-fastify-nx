import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

@Injectable()
export class HeartbeatTask {
  private readonly logger = new Logger(HeartbeatTask.name);

  constructor(private readonly prisma: PrismaService) {}

  // Ping the DB every minute to detect connectivity issues early.
  @Cron(CronExpression.EVERY_MINUTE)
  async ping(): Promise<void> {
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
      this.logger.debug('DB heartbeat OK');
    } catch (error) {
      this.logger.error(`DB heartbeat FAILED: ${String(error)}`);
    }
  }
}
