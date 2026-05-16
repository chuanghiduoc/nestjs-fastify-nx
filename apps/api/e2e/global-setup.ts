import { execSync } from 'child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

// Shared container instances — stopped in global-teardown.ts.
// Using module-level vars so teardown can reference them without globalThis serialization.
let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;

declare global {
  var __E2E_POSTGRES__: StartedPostgreSqlContainer;
  var __E2E_REDIS__: StartedRedisContainer;
}

export async function setup(): Promise<void> {
  [postgresContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine').start(),
    new RedisContainer('redis:8-alpine').start(),
  ]);

  // Expose via globalThis so createTestApp() can read them without re-importing
  // containers package in each spec file.
  globalThis.__E2E_POSTGRES__ = postgresContainer;
  globalThis.__E2E_REDIS__ = redisContainer;

  const dbUrl = postgresContainer.getConnectionUri();

  // Wire env early so prisma migrate deploy picks up the right DB.
  process.env['DATABASE_URL'] = dbUrl;
  process.env['E2E_DATABASE_URL'] = dbUrl;
  process.env['E2E_REDIS_HOST'] = redisContainer.getHost();
  process.env['E2E_REDIS_PORT'] = String(redisContainer.getFirstMappedPort());

  // Run migrations once against the shared container.
  execSync('pnpm prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });
}

export async function teardown(): Promise<void> {
  await Promise.all([globalThis.__E2E_POSTGRES__?.stop(), globalThis.__E2E_REDIS__?.stop()]);
}
