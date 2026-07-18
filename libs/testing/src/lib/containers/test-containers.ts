import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { RedisContainer } from '@testcontainers/redis';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  teardown: () => Promise<void>;
}

// Images match docker/compose.yml so tests exercise what the apps run against. Sequential, not
// Promise.all: a rejection there discards the other handle, leaking a running container.
export async function createTestContainers(): Promise<TestContainers> {
  const postgres = await new PostgreSqlContainer('postgres:18-alpine').start();
  let redis: StartedRedisContainer;
  try {
    redis = await new RedisContainer('redis:8-alpine').start();
  } catch (error) {
    await postgres.stop().catch(() => undefined);
    throw error;
  }

  return {
    postgres,
    redis,
    teardown: async () => {
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}
