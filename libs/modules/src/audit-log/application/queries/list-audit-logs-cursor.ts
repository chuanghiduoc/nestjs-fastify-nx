import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS, invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, lastCursorOf, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import {
  AUDIT_LOG_REPOSITORY_PORT,
  type AuditLogRepositoryPort,
} from '../../domain/ports/audit-log-repository.port';

export interface AuditLogListItemDto {
  readonly id: string;
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly action: string;
  readonly resource: string | null;
  readonly metadata: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

export interface ListAuditLogsCursorResult {
  data: AuditLogListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListAuditLogsCursorFilters {
  readonly startingAfter?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly userId?: string;
  readonly occurredFrom?: Date;
  readonly occurredUntil?: Date;
}

export class ListAuditLogsCursorQuery extends Query<ListAuditLogsCursorResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly userId?: string;
  readonly occurredFrom?: Date;
  readonly occurredUntil?: Date;

  constructor(organizationId: string, limit: number, filters: ListAuditLogsCursorFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.action = filters.action;
    this.resource = filters.resource;
    this.userId = filters.userId;
    this.occurredFrom = filters.occurredFrom;
    this.occurredUntil = filters.occurredUntil;
  }
}

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
