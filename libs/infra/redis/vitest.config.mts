import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-redis',
  rootDir: 'libs/infra/redis',
  coverageThresholds: { lines: 50, functions: 50, branches: 50, statements: 50 },
});
