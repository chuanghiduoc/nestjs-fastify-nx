import { defineVitestConfig } from '../../vitest.shared';

export default defineVitestConfig({
  name: 'api',
  rootDir: 'apps/api',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // Bootstrap-only surfaces: they wire the process together and are exercised by
  // apps/api/e2e + the CI docker-smoke job, never by unit tests.
  coverageExclude: ['src/main.ts', 'src/tracing.ts', 'src/common/swagger/**'],
  coverageThresholds: {
    lines: 60,
    functions: 60,
    branches: 55,
    statements: 60,
  },
});
