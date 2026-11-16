import { describe, expect, it, vi } from 'vitest';
import { DatabaseCleaner, type CleanerDatabase } from './database-cleaner';

function prismaDouble(tables: string[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(tables.map((tablename) => ({ tablename }))),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  } as unknown as CleanerDatabase;
}

describe('DatabaseCleaner', () => {
  it('truncates every public table with cascade and identity reset', async () => {
    const prisma = prismaDouble(['users', 'sessions']);
    const cleaner = new DatabaseCleaner(prisma);

    await cleaner.truncateAll();

    const statement = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][0] as string;
    expect(statement).toBe('TRUNCATE TABLE "users", "sessions" RESTART IDENTITY CASCADE');
  });

  it('builds the statement once and reuses it', async () => {
    const prisma = prismaDouble(['users']);
    const cleaner = new DatabaseCleaner(prisma);

    await cleaner.truncateAll();
    await cleaner.truncateAll();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('does not issue a truncate when the database has no public tables', async () => {
    const prisma = prismaDouble([]);
    const cleaner = new DatabaseCleaner(prisma);

    await cleaner.truncateAll();

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
