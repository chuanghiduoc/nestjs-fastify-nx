import { defineVitestConfig } from '../../vitest.shared';

export default defineVitestConfig({
  name: 'api',
  rootDir: 'apps/api',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
  coverageExclude: [
    'src/main.ts',
    'src/tracing.ts',
    'src/common/swagger/**',
    'src/common/logging/dev-request-logger.ts',
  ],
  coverageThresholds: {
    lines: 60,
    functions: 60,
    branches: 55,
    statements: 60,
  },
});
