export interface CleanerDatabase {
  $executeRawUnsafe(query: string): Promise<unknown>;
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export class DatabaseCleaner {
  private truncateStatement: string | undefined;

  constructor(private readonly prisma: CleanerDatabase) {}

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
