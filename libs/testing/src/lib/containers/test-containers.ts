import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  teardown: () => Promise<void>;
}

export async function createTestContainers(): Promise<TestContainers> {
  const postgres = await new PostgreSqlContainer('postgres:18-alpine').start();
  let redis: StartedRedisContainer;
  try {
    redis = await new RedisContainer('redis:7-alpine').start();
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
