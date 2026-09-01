import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';

export interface BatchedPurgeConfig {
  readonly table: string;
  readonly column: string;
  readonly envPrefix: string;
  readonly defaultBatchSize: number;
  readonly defaultMaxBatches: number;
  readonly label: string;
}

@Injectable()
export class BatchedPurgeRunner {
  private readonly logger = new Logger(BatchedPurgeRunner.name);
  private readonly running = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async purgeIfLeader(
    key: string,
    isLeader: boolean,
    config: BatchedPurgeConfig,
    cutoffDays: number,
  ): Promise<void> {
    if (!isLeader || this.running.has(key)) return;
    this.running.add(key);

    const batchSize = positiveIntEnv(
      `${config.envPrefix}_PURGE_BATCH_SIZE`,
      config.defaultBatchSize,
    );
    const maxBatches = positiveIntEnv(
      `${config.envPrefix}_PURGE_MAX_BATCHES`,
      config.defaultMaxBatches,
    );
    this.logger.log(`Starting ${config.label}: ${config.column} < NOW() - ${cutoffDays} days`);

    let totalPurged = 0;
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        const deleted = await this.prisma.db.$executeRawUnsafe<number>(
          `DELETE FROM "${config.table}"
             WHERE id IN (
               SELECT id FROM "${config.table}"
                WHERE "${config.column}" < NOW() - ($1 || ' days')::interval
                LIMIT $2
             )`,
          String(cutoffDays),
          batchSize,
        );
        const n = Number(deleted ?? 0);
        if (n === 0) break;
        totalPurged += n;
      }
      this.logger.log(`${config.label} complete: ${totalPurged} row(s) deleted`);
    } catch (err) {
      this.logger.error({ err, totalPurged }, `${config.label} failed`);
    } finally {
      this.running.delete(key);
    }
  }
}
