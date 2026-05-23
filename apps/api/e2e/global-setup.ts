import { execSync } from 'child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';

declare global {
  var __E2E_POSTGRES__: StartedPostgreSqlContainer;
  var __E2E_REDIS__: StartedRedisContainer;
}

async function stopContainers(): Promise<void> {
  await Promise.all([globalThis.__E2E_POSTGRES__?.stop(), globalThis.__E2E_REDIS__?.stop()]);
}

export async function setup(): Promise<void> {
  const [postgresContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine').start(),
    new RedisContainer('redis:8-alpine').start(),
  ]);

  // Expose via globalThis so createTestApp() can read them without re-importing
  // containers package in each spec file.
  globalThis.__E2E_POSTGRES__ = postgresContainer;
  globalThis.__E2E_REDIS__ = redisContainer;

  // Stop containers on SIGINT/SIGTERM (CI cancel, Ctrl-C) so Docker resources
  // are not leaked when Vitest's teardown export is bypassed by process kill.
  const handleSignal = (): void => {
    void stopContainers().finally(() => process.exit(0));
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  const dbUrl = postgresContainer.getConnectionUri();
  const redisHost = redisContainer.getHost();
  const redisPort = String(redisContainer.getFirstMappedPort());

  // Forked workers inherit env from this process, so setting the real keys
  // here means every module-init read (BullModule.forRootAsync, indicators,
  // gateway) sees the testcontainer values before any default kicks in.
  process.env['DATABASE_URL'] = dbUrl;
  process.env['E2E_DATABASE_URL'] = dbUrl;
  process.env['E2E_REDIS_HOST'] = redisHost;
  process.env['E2E_REDIS_PORT'] = redisPort;
  process.env['REDIS_CACHE_HOST'] = redisHost;
  process.env['REDIS_CACHE_PORT'] = redisPort;
  process.env['REDIS_QUEUE_HOST'] = redisHost;
  process.env['REDIS_QUEUE_PORT'] = redisPort;

  // Run migrations once against the shared container. Any failure here means
  // every subsequent spec will time out against a broken schema — exit loud
  // immediately rather than letting Vitest proceed with phantom timeouts.
  try {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('prisma migrate deploy failed — aborting e2e run', err);
    await stopContainers();
    process.exit(1);
  }
}

export async function teardown(): Promise<void> {
  await stopContainers();
}
