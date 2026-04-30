import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { Prisma } from '@prisma/client';
import type { AuditLogRepositoryPort } from '../../domain/ports/audit-log-repository.port';
import type { AuditLog } from '../../domain/entities/audit-log.entity';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  private readonly logger = new Logger(PrismaAuditLogRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(entry: AuditLog): Promise<void> {
    try {
      await this.prisma.db.auditLog.create({
        data: {
          id: entry.id,
          userId: entry.userId,
          action: entry.action,
          resource: entry.resource,
          metadata: entry.metadata as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          createdAt: entry.createdAt,
        },
      });
    } catch (err) {
      // Audit failures must never break the request that triggered the
      // event. Log and swallow — we still preserve in-flight observability
      // via Pino, and pollination of failure metrics is handled elsewhere.
      this.logger.error(
        `Failed to persist audit entry id=${entry.id} action=${entry.action}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
