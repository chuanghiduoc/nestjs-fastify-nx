import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The inferred @nx/vitest target runs vitest with cwd = projectRoot (not the
// workspace root the old executor used), so `prisma migrate deploy` can no longer
// find prisma/schema.prisma via the current directory. Walk up from cwd to the
// directory that actually holds the schema and run the migration there, so the
// call works regardless of which project's test suite invokes it.
function resolveWorkspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'prisma', 'schema.prisma'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate prisma/schema.prisma above the current working directory');
    }
    dir = parent;
  }
  return dir;
}

export function deployTestMigrations(databaseUrl: string): void {
  execSync('pnpm prisma migrate deploy', {
    cwd: resolveWorkspaceRoot(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
