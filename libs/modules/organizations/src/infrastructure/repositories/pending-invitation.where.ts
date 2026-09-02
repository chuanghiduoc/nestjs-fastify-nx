import type { Prisma } from '@nestjs-fastify-nx/infra-database';

export function pendingInvitationWhere(now: Date): Prisma.InvitationWhereInput {
  return { status: 'pending', expiresAt: { gt: now } };
}
