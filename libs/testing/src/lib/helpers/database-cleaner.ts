import type { PrismaClient } from '@nestjs-fastify-nx/infra-database';

export class DatabaseCleaner {
  private truncateStatement: string | undefined;

  constructor(private readonly prisma: PrismaClient) {}

  async truncateAll(): Promise<void> {
    this.truncateStatement ??= await this.buildTruncateStatement();
    if (this.truncateStatement) {
      await this.prisma.$executeRawUnsafe(this.truncateStatement);
    }
  }

  private async buildTruncateStatement(): Promise<string> {
    const tables = await this.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
    `;

    const tableNames = tables.map((t) => `"${t.tablename}"`).join(', ');
    return tableNames ? `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE` : '';
  }
}
