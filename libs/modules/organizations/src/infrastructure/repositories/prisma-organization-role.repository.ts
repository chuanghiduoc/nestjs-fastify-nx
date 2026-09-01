import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import {
  parsePermissionStatements,
  serializePermissionStatements,
} from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from '../../domain/entities/organization-role.entity';
import type { OrganizationRoleRepositoryPort } from '../../domain/ports/organization-role-repository.port';
import { roleAlreadyExists } from '../../application/organization-errors';

type OrganizationRoleRow = {
  id: string;
  organizationId: string;
  role: string;
  permission: string;
  createdAt: Date;
  updatedAt: Date | null;
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

  async update(role: OrganizationRole): Promise<void> {
    await this.prisma.writeTarget().organizationRole.update({
      where: { organizationId_role: { organizationId: role.organizationId, role: role.role } },
      data: { permission: serializePermissionStatements(role.permissions) },
    });
  }

  async delete(organizationId: string, role: string): Promise<boolean> {
    const { count } = await this.prisma
      .writeTarget()
      .organizationRole.deleteMany({ where: { organizationId, role } });
    return count > 0;
  }

  // Better Auth stores several roles as a comma-separated list in one column, so an equality
  // predicate would miss "owner,auditor". Splitting in SQL keeps the count on the index instead of
  // streaming every membership row into the process.
  async countMembersHolding(organizationId: string, role: string): Promise<number> {
    const rows = await this.prisma.readTarget().$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM "members"
       WHERE "organizationId" = ${organizationId}::uuid
         AND ${role} = ANY(string_to_array(regexp_replace("role", '\s', '', 'g'), ','))
    `;
    return rows[0]?.count ?? 0;
  }
}
