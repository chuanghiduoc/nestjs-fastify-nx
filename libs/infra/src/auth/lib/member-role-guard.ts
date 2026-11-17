import { APIError } from 'better-auth/api';
import type { PrismaClient } from '@nestjs-fastify-nx/infra/database';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { SYSTEM_ROLES } from '@nestjs-fastify-nx/shared';

export const MEMBER_ROLE_NOT_DEFINED_MESSAGE =
  'A role in this membership is no longer defined in the organization';

const SYSTEM_ROLE_NAMES: ReadonlySet<string> = new Set(Object.values(SYSTEM_ROLES));

function customRoleNames(rawRole: string): string[] {
  const names = rawRole
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role !== '' && !SYSTEM_ROLE_NAMES.has(role));
  return [...new Set(names)];
}

export async function assertMemberRolesDefined(
  prisma: PrismaClient,
  organizationId: string,
  rawRole: string,
): Promise<void> {
  const names = customRoleNames(rawRole);
  if (names.length === 0) return;
  const defined = await prisma.organizationRole.count({
    where: { organizationId, role: { in: names } },
  });
  if (defined === names.length) return;
  throw new APIError('NOT_FOUND', {
    code: ERROR_CODES.ORGANIZATION_ROLE_NOT_FOUND,
    message: MEMBER_ROLE_NOT_DEFINED_MESSAGE,
  });
}
