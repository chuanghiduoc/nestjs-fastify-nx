import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-auth',
  rootDir: 'libs/infra/auth',
  coverageExclude: ['src/lib/better-auth.config.ts'],
  coverageThresholds: { lines: 50, functions: 50, branches: 50, statements: 50 },
});
