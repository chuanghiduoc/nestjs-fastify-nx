import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import type {
  AuditLogRepositoryPort,
  FindAuditLogsCursorOptions,
  FindAuditLogsCursorResult,
} from '../../domain/ports/audit-log-repository.port';
import { AuditLog } from '../../domain/entities/audit-log.entity';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  private readonly logger = new Logger(PrismaAuditLogRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(entry: AuditLog): Promise<void> {
    try {
      const client = this.prisma.writeTarget();
      await client.auditLog.create({
        data: {
          id: entry.id,
          organizationId: entry.organizationId,
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

  async findAllCursor(options: FindAuditLogsCursorOptions): Promise<FindAuditLogsCursorResult> {
    const { organizationId, startingAfter, limit, action, resource, userId } = options;

    const where: Prisma.AuditLogWhereInput = { organizationId };
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (userId) where.userId = userId;

    const createdAtRange = buildRange(options.occurredFrom, options.occurredUntil);
    if (createdAtRange) where.createdAt = createdAtRange;

    if (startingAfter) {
      where.AND = [
        {
          OR: [
            { createdAt: { lt: startingAfter.createdAt } },
            { AND: [{ createdAt: startingAfter.createdAt }, { id: { lt: startingAfter.id } }] },
          ],
        },
      ];
    }

    // `audit_logs` is behind row-level security, so the read has to run with the tenant setting
    // bound on the same transaction the query uses. A plain readTarget() query is not rejected —
    // it silently returns zero rows, which would read as "this organization has no audit trail".
    const rows = await this.prisma.withTenantContext(
      (client) =>
        client.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        }),
      { readOnly: true },
    );

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) =>
      AuditLog.reconstitute({
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        action: row.action,
        resource: row.resource,
        metadata: toMetadata(row.metadata),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
      }),
    );

    return { items, hasMore };
  }
}

function buildRange(from?: Date, until?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !until) return undefined;
  return { ...(from ? { gte: from } : {}), ...(until ? { lte: until } : {}) };
}

function toMetadata(raw: Prisma.JsonValue): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
}
