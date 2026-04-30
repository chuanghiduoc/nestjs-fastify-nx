import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  teardown: () => Promise<void>;
}

export async function createTestContainers(): Promise<TestContainers> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  return {
    postgres,
    redis,
    teardown: async () => {
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}
