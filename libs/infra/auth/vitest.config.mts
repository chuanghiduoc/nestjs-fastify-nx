import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-auth',
  rootDir: 'libs/infra/auth',
  coverageExclude: ['src/lib/better-auth.config.ts'],
  coverageThresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
});
