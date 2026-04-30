import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { UserStatus } from '@nestjs-fastify-nx/modules-users';

/**
 * CleanupTask — scheduled maintenance jobs for the database.
 *
 * Token cleanup note:
 *   Blacklisted access-token keys (`blacklist:<jti>`) and refresh-token keys
 *   (`refresh:<userId>:<jti>`) are stored in Redis with an explicit TTL that
 *   mirrors the token's own expiry.  Redis expires those keys automatically,
 *   so no scheduled cleanup job is required for token data.  Any key stored
 *   without a TTL would indicate a bug in the auth layer, not something this
 *   task should paper over.
 */
@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs every day at 02:00 UTC.
   *
   * Hard-deletes User records that have been in INACTIVE status for more than
   * 90 days.  INACTIVE accounts are set by the deactivation flow and represent
   * users that have been soft-deleted.  Keeping them longer than 90 days
   * provides a grace period for reactivation before permanent removal.
   *
   * The `refresh_tokens` table referenced in a previous version of this task
   * does NOT exist — the application uses Redis for token storage.  That raw
   * SQL has been removed.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeInactiveUsers(): Promise<void> {
    this.logger.log('Starting inactive-user purge (>90 days INACTIVE)');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    try {
      const { count } = await this.prisma.db.user.deleteMany({
        where: {
          status: UserStatus.INACTIVE,
          updatedAt: { lt: cutoff },
        },
      });

      this.logger.log(`Purged ${count} inactive user(s) updated before ${cutoff.toISOString()}`);
    } catch (error) {
      this.logger.error(`Inactive-user purge failed: ${String(error)}`);
    }
  }

  // Runs every Sunday at 03:00 UTC — VACUUM ANALYZE for Postgres health.
  @Cron('0 3 * * 0')
  async vacuumDatabase(): Promise<void> {
    this.logger.log('Running VACUUM ANALYZE');

    try {
      await this.prisma.db.$executeRaw`VACUUM ANALYZE`;
      this.logger.log('VACUUM ANALYZE complete');
    } catch (error) {
      this.logger.error(`VACUUM ANALYZE failed: ${String(error)}`);
    }
  }
}
