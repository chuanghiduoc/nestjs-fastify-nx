import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
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
      // P2002 = PK collision on outbox redelivery — idempotency signal, not a real error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(
          `audit_logs duplicate id=${entry.id} action=${entry.action} — outbox redelivery, ignoring`,
        );
        return;
      }
      // All other failures must propagate so the outbox relay records lastError.
      throw err;
    }
  }
}
