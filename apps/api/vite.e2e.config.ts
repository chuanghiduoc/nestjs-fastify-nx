import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Test-file resolution (include, globalSetup) is anchored to this dir so it works
  // regardless of the shell cwd. The app itself resolves i18n/asset paths from
  // process.cwd(), which must stay the workspace root — the e2e target runs from
  // there (no `cwd` override), matching how the app runs under nx serve / prod.
  root: __dirname,
  resolve: { tsconfigPaths: true },
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
