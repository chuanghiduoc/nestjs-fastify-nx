import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS, invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, lastCursorOf, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { AUDIT_LOG_REPOSITORY_PORT } from '../../../domain/ports/audit-log-repository.port';
import type { AuditLogRepositoryPort } from '../../../domain/ports/audit-log-repository.port';
import type { AuditLogListItemDto } from '../../dto/audit-log-list-item.dto';
import {
  ListAuditLogsCursorQuery,
  type ListAuditLogsCursorResult,
} from './list-audit-logs-cursor.query';

@QueryHandler(ListAuditLogsCursorQuery)
export class ListAuditLogsCursorHandler implements IQueryHandler<
  ListAuditLogsCursorQuery,
  ListAuditLogsCursorResult
> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY_PORT) private readonly repository: AuditLogRepositoryPort,
  ) {}

  async execute(query: ListAuditLogsCursorQuery): Promise<ListAuditLogsCursorResult> {
    this.assertRangeOrdered(query.occurredFrom, query.occurredUntil);

    const { items, hasMore } = await this.repository.findAllCursor({
      organizationId: query.organizationId,
      startingAfter: this.decodeStartingAfter(query.startingAfter),
      limit: query.limit,
      action: query.action,
      resource: query.resource,
      userId: query.userId,
      occurredFrom: query.occurredFrom,
      occurredUntil: query.occurredUntil,
    });

    const data: AuditLogListItemDto[] = items.map((entry) => ({
      id: entry.id,
      organizationId: entry.organizationId,
      userId: entry.userId,
      action: entry.action,
      resource: entry.resource,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      createdAt: entry.createdAt,
    }));

    return { data, hasMore, lastCursor: lastCursorOf(items) };
  }

  private assertRangeOrdered(from?: Date, until?: Date): void {
    if (!from || !until || from.getTime() <= until.getTime()) return;

    throw new DomainException({
      kind: 'validation',
      code: ERROR_CODES.VALIDATION_FAILED,
      title: I18N_KEYS.common.unprocessable_entity,
      messageKey: I18N_KEYS.errors.audit_log.invalid_range,
      violations: [
        {
          path: 'occurredFrom',
          code: 'range_out_of_order',
          message: 'occurredFrom must not be later than occurredUntil',
          messageKey: I18N_KEYS.errors.audit_log.invalid_range,
        },
      ],
    });
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;

    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());

    return decoded;
  }
}
