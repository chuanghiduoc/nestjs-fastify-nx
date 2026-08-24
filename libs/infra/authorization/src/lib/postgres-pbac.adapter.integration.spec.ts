import { Client } from 'pg';
import { createTestContainers, deployTestMigrations } from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PostgresPbacAdapter } from './postgres-pbac.adapter';
import { describeAuthorizationConformance, CONFORMANCE_IDS } from './authorization-conformance';

let containers: TestContainers | undefined;
let admin: Client | undefined;
let prisma: PrismaService | undefined;

async function bootstrap(): Promise<{ admin: Client; prisma: PrismaService }> {
  if (!containers) {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    deployTestMigrations(dbUrl);
    process.env['DATABASE_URL'] = dbUrl;

    admin = new Client({ connectionString: dbUrl });
    await admin.connect();

    prisma = new PrismaService();
    await prisma.onModuleInit();
  }
  return { admin: admin as Client, prisma: prisma as PrismaService };
}

describeAuthorizationConformance({
  name: 'PostgresPbacAdapter',
  async create() {
    const { admin: db, prisma: prismaService } = await bootstrap();

    await db.query('TRUNCATE organization_roles, members, organizations, users CASCADE');

    for (const [key, id] of Object.entries(CONFORMANCE_IDS)) {
      if (['orgA', 'orgB', 'file'].includes(key)) continue;
      await db.query(
        'INSERT INTO users (id, name, email, "updatedAt") VALUES ($1, $2, $3, NOW())',
        [id, key, `${key}@conformance.local`],
      );
    }
    await db.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
      CONFORMANCE_IDS.orgA,
      'Org A',
      'org-a',
      CONFORMANCE_IDS.orgB,
      'Org B',
      'org-b',
    ]);

    return {
      authorization: new PostgresPbacAdapter(prismaService),
      async grantRoles(organizationId, userId, roles) {
        await db.query(
          `INSERT INTO members ("organizationId", "userId", role) VALUES ($1, $2, $3)
           ON CONFLICT ("organizationId", "userId") DO UPDATE SET role = EXCLUDED.role`,
          [organizationId, userId, roles.join(',')],
        );
      },
      async defineCustomRole(organizationId, role, permissions) {
        const byResource: Record<string, string[]> = {};
        for (const permission of permissions) {
          const [resource, action] = permission.split(':');
          if (!resource || !action) continue;
          (byResource[resource] ??= []).push(action);
        }
        await db.query(
          `INSERT INTO organization_roles ("organizationId", role, permission) VALUES ($1, $2, $3)
           ON CONFLICT ("organizationId", role) DO UPDATE SET permission = EXCLUDED.permission`,
          [organizationId, role, JSON.stringify(byResource)],
        );
      },
    };
  },
});
