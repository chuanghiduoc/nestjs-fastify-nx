import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { Prisma } from '@nestjs-fastify-nx/infra/database';
import {
  parsePermissionStatements,
  serializePermissionStatements,
} from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from '../../domain/entities/organization-role.entity';
import type {
  OrganizationRoleRepositoryPort,
  RoleDeletionOutcome,
} from '../../domain/ports/organization-role-repository.port';
import { roleAlreadyExists } from '../../application/organization-errors';

type OrganizationRoleRow = {
  id: string;
  organizationId: string;
  role: string;
  permission: string;
  createdAt: Date;
  updatedAt: Date | null;
};

const RAW_QUERY_FAILED = 'P2010';
const HELD_ROLE_CONSTRAINT = 'organization_roles_unheld';

type DriverAdapterFailure = {
  driverAdapterError?: { cause?: { constraint?: { index?: string } } };
};

type DeleteUnlessHeldRow = {
  found: boolean;
  holders: number;
  deleted: boolean;
};

function toEntity(row: OrganizationRoleRow): OrganizationRole {
  return OrganizationRole.reconstitute({
    id: row.id,
    organizationId: row.organizationId,
    role: row.role,
    permissions: parsePermissionStatements(row.permission).granted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toDeletionOutcome(row: DeleteUnlessHeldRow | undefined): RoleDeletionOutcome {
  if (!row || !row.found) return 'not_found';
  if (row.deleted) return 'deleted';
  // Not deleted with no holders means a concurrent request removed the row between the snapshot the
  // count came from and the delete — absent, not in use.
  return row.holders > 0 ? 'in_use' : 'not_found';
}

function isHeldRoleRejection(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === RAW_QUERY_FAILED &&
    (err.meta as DriverAdapterFailure | undefined)?.driverAdapterError?.cause?.constraint?.index ===
      HELD_ROLE_CONSTRAINT
  );
}

@Injectable()
export class PrismaOrganizationRoleRepository implements OrganizationRoleRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string): Promise<OrganizationRole[]> {
    const rows = await this.prisma.readTarget().organizationRole.findMany({
      where: { organizationId },
      orderBy: { role: 'asc' },
    });
    return rows.map(toEntity);
  }

  async findByName(organizationId: string, role: string): Promise<OrganizationRole | null> {
    const row = await this.prisma.writeTarget().organizationRole.findUnique({
      where: { organizationId_role: { organizationId, role } },
    });
    return row ? toEntity(row) : null;
  }

  async create(role: OrganizationRole): Promise<void> {
    try {
      await this.prisma.writeTarget().organizationRole.create({
        data: {
          id: role.id,
          organizationId: role.organizationId,
          role: role.role,
          permission: serializePermissionStatements(role.permissions),
          createdAt: role.createdAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw roleAlreadyExists();
      }
      throw err;
    }
  }

  async update(role: OrganizationRole): Promise<boolean> {
    const { count } = await this.prisma.writeTarget().organizationRole.updateMany({
      where: { organizationId: role.organizationId, role: role.role },
      data: { permission: serializePermissionStatements(role.permissions) },
    });
    return count > 0;
  }

  async deleteUnlessHeld(organizationId: string, role: string): Promise<RoleDeletionOutcome> {
    try {
      return toDeletionOutcome(await this.deleteWhenUnheld(organizationId, role));
    } catch (err) {
      if (isHeldRoleRejection(err)) return 'in_use';
      throw err;
    }
  }

  private async deleteWhenUnheld(
    organizationId: string,
    role: string,
  ): Promise<DeleteUnlessHeldRow | undefined> {
    const rows = await this.prisma.writeTarget().$queryRaw<DeleteUnlessHeldRow[]>`
      WITH target AS (
        SELECT "id"
          FROM "organization_roles"
         WHERE "organizationId" = ${organizationId}::uuid
           AND "role" = ${role}
      ),
      holders AS (
        SELECT COUNT(*)::int AS "count"
          FROM "members"
         WHERE "organizationId" = ${organizationId}::uuid
           AND ${role} = ANY(parse_member_roles("role"))
      ),
      deleted AS (
        DELETE FROM "organization_roles"
         WHERE "id" IN (SELECT "id" FROM target)
           AND (SELECT "count" FROM holders) = 0
        RETURNING "id"
      )
      SELECT EXISTS (SELECT 1 FROM target) AS "found",
             (SELECT "count" FROM holders) AS "holders",
             EXISTS (SELECT 1 FROM deleted) AS "deleted"
    `;
    return rows[0];
  }
}
