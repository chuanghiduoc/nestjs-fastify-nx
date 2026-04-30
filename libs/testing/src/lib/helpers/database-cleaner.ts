import type { PrismaClient } from '@prisma/client';

export class DatabaseCleaner {
  constructor(private readonly prisma: PrismaClient) {}

  async truncateAll(): Promise<void> {
    const tables = await this.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
    `;

    const tableNames = tables.map((t) => `"${t.tablename}"`).join(', ');
    if (tableNames) {
      await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
    }
  }
}
