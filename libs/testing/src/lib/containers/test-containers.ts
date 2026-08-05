import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { RedisContainer } from '@testcontainers/redis';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  teardown: () => Promise<void>;
}

// TESTCONTAINERS_REUSE=true enables container reuse across test runs. Disabled by default for CI.
export async function createTestContainers(): Promise<TestContainers> {
  const reuse = process.env['TESTCONTAINERS_REUSE'] === 'true';

  const pgContainer = new PostgreSqlContainer('postgres:18-alpine');
  const postgres = await (reuse ? pgContainer.withReuse() : pgContainer).start();

  let redis: StartedRedisContainer;
  try {
    const redisContainer = new RedisContainer('redis:8-alpine');
    redis = await (reuse ? redisContainer.withReuse() : redisContainer).start();
  } catch (error) {
    if (!reuse) await postgres.stop().catch(() => undefined);
    throw error;
  }

  return {
    postgres,
    redis,
    teardown: async () => {
      if (reuse) return;
      const results = await Promise.allSettled([postgres.stop(), redis.stop()]);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [String(result.reason)] : [],
      );
      if (failures.length > 0) {
        throw new Error(`Failed to stop test container(s): ${failures.join('; ')}`);
      }
    },
  };
}
