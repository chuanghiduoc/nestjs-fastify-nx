import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { RedisContainer } from '@testcontainers/redis';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  teardown: () => Promise<void>;
}

const EPHEMERAL_POSTGRES_COMMAND = [
  'postgres',
  '-c',
  'fsync=off',
  '-c',
  'synchronous_commit=off',
  '-c',
  'full_page_writes=off',
];

// TESTCONTAINERS_REUSE=true enables container reuse across test runs. Disabled by default for CI.
export async function createTestContainers(): Promise<TestContainers> {
  const reuse = process.env['TESTCONTAINERS_REUSE'] === 'true';

  const pgContainer = new PostgreSqlContainer('postgres:18-alpine').withCommand(
    EPHEMERAL_POSTGRES_COMMAND,
  );
  const redisContainer = new RedisContainer('redis:8-alpine');

  const [postgresResult, redisResult] = await Promise.allSettled([
    (reuse ? pgContainer.withReuse() : pgContainer).start(),
    (reuse ? redisContainer.withReuse() : redisContainer).start(),
  ]);

  const stopStarted = async (): Promise<void> => {
    if (reuse) return;
    await Promise.allSettled([
      postgresResult.status === 'fulfilled' ? postgresResult.value.stop() : Promise.resolve(),
      redisResult.status === 'fulfilled' ? redisResult.value.stop() : Promise.resolve(),
    ]);
  };

  if (postgresResult.status === 'rejected') {
    await stopStarted();
    throw postgresResult.reason;
  }
  if (redisResult.status === 'rejected') {
    await stopStarted();
    throw redisResult.reason;
  }

  const postgres = postgresResult.value;
  const redis = redisResult.value;

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
