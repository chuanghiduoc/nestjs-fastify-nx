import { createTestContainers, deployTestMigrations } from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';

// Vitest loads this module once and calls both hooks on it, so module scope is enough to hand the
// handle from setup to teardown. Specs read the endpoints from process.env, not from here.
let containers: TestContainers | undefined;

async function stopContainers(): Promise<void> {
  await containers?.teardown().catch(() => undefined);
  containers = undefined;
}

export async function setup(): Promise<void> {
  const externalDbUrl = process.env['E2E_DATABASE_URL'];
  const externalRedisHost = process.env['E2E_REDIS_HOST'];
  const externalRedisPort = process.env['E2E_REDIS_PORT'];
  const externalValues = [externalDbUrl, externalRedisHost, externalRedisPort];
  if (externalValues.some(Boolean) && !externalValues.every(Boolean)) {
    throw new Error(
      'E2E_DATABASE_URL, E2E_REDIS_HOST and E2E_REDIS_PORT must be provided together',
    );
  }

  if (externalDbUrl && externalRedisHost && externalRedisPort) {
    configureTestEnvironment(externalDbUrl, externalRedisHost, externalRedisPort);
    deployTestMigrations(externalDbUrl);
    return;
  }

  // Shared helper rather than a local Promise.all: it starts the containers sequentially and stops
  // the first one if the second fails, so a half-started pair can't leak past this process.
  containers = await createTestContainers();

  // Stop containers on SIGINT/SIGTERM (CI cancel, Ctrl-C) so Docker resources
  // are not leaked when Vitest's teardown export is bypassed by process kill.
  const handleSignal = (): void => {
    void stopContainers().finally(() => process.exit(0));
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  const dbUrl = containers.postgres.getConnectionUri();
  configureTestEnvironment(
    dbUrl,
    containers.redis.getHost(),
    String(containers.redis.getFirstMappedPort()),
  );

  // Run migrations once against the shared container. Any failure here means
  // every subsequent spec will time out against a broken schema — exit loud
  // immediately rather than letting Vitest proceed with phantom timeouts.
  try {
    deployTestMigrations(dbUrl);
  } catch (err) {
    console.error('prisma migrate deploy failed — aborting e2e run', err);
    await stopContainers();
    process.exit(1);
  }
}

function configureTestEnvironment(dbUrl: string, redisHost: string, redisPort: string): void {
  // Forked workers inherit env from global setup, so every module-init read sees test endpoints.
  process.env['DATABASE_URL'] = dbUrl;
  process.env['E2E_DATABASE_URL'] = dbUrl;
  process.env['E2E_REDIS_HOST'] = redisHost;
  process.env['E2E_REDIS_PORT'] = redisPort;
  process.env['REDIS_CACHE_HOST'] = redisHost;
  process.env['REDIS_CACHE_PORT'] = redisPort;
  process.env['REDIS_QUEUE_HOST'] = redisHost;
  process.env['REDIS_QUEUE_PORT'] = redisPort;
}

export async function teardown(): Promise<void> {
  await stopContainers();
}
