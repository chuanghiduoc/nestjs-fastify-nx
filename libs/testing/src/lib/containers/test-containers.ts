import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  teardown: () => Promise<void>;
}

// Pinned to the same major as docker/compose.yml so tests exercise the Redis the apps actually run
// against. Started sequentially, not via Promise.all: a rejected Promise.all discards the other
// container's handle mid-flight, leaving it running with nothing left holding a reference to stop it.
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
