import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import type {
  FindInvitationsCursorOptions,
  FindInvitationsCursorResult,
  InvitationRecord,
  InvitationRepositoryPort,
  InvitationStatus,
} from '../../domain/ports/invitation-repository.port';
import { pendingInvitationWhere } from './pending-invitation.where';

type InvitationRow = {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  teamId: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
  createdAt: Date;
};

function toRecord(row: InvitationRow): InvitationRecord {
  return { ...row, status: row.status as InvitationStatus };
}

function statusWhere(status: InvitationStatus, now: Date): Prisma.InvitationWhereInput {
  return status === 'pending' ? pendingInvitationWhere(now) : { status };
}

@Injectable()
export class PrismaInvitationRepository implements InvitationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllCursor(options: FindInvitationsCursorOptions): Promise<FindInvitationsCursorResult> {
    const { organizationId, startingAfter, limit, status, email } = options;

    const where: Prisma.InvitationWhereInput = {
      organizationId,
      ...(status ? statusWhere(status, new Date()) : {}),
    };
    if (email) where.email = email.toLowerCase();
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

    const rows = await this.prisma.readTarget().invitation.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: (hasMore ? rows.slice(0, limit) : rows).map(toRecord), hasMore };
  }

  async findById(organizationId: string, id: string): Promise<InvitationRecord | null> {
    const row = await this.prisma
      .writeTarget()
      .invitation.findFirst({ where: { id, organizationId } });
    return row ? toRecord(row) : null;
  }

  // Compare-and-set on the live row: a second concurrent cancel matches zero rows and is reported
  // as "not pending" rather than silently succeeding twice.
  async cancelPending(organizationId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.writeTarget().invitation.updateMany({
      where: { id, organizationId, status: 'pending' },
      data: { status: 'canceled' },
    });
    return count > 0;
  }
}
