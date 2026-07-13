import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.e2e-spec.ts'],
    env: { ENABLE_METRICS: 'true' },
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
    reporters: ['default'],
    // Boot Postgres + Redis once for the entire e2e run; each spec calls
    // databaseCleaner.truncateAll() in beforeEach to maintain isolation.
    globalSetup: ['./e2e/global-setup.ts'],
  },
});
