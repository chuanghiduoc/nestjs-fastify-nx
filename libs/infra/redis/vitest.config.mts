import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-redis',
  rootDir: 'libs/infra/redis',
  coverageThresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
});
